#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "bigint") return String(value);
  }
  return undefined;
}

function configuredHostAccountId(config) {
  return firstString(config.plugins?.entries?.clawclave?.config?.hostAccountId, config.plugins?.clawclave?.hostAccountId) ?? "host";
}

function buildSystemPrompt(group, review, role) {
  const base = [
    `Sub-company: ${group.name} (${group.slug})`,
    `One-line goal: ${group.oneLineGoal}`,
    `North Star: ${group.northStar}`,
    `Operating metrics: 1. ${group.operatingMetrics[0]} 2. ${group.operatingMetrics[1]}`,
    `Guardrail metrics: 1. ${group.guardrailMetrics[0]} 2. ${group.guardrailMetrics[1]}`,
    `Review cadence: every ${review.cadenceDays} days.`,
    `Stats location: ${review.statsPath}`
  ];

  if (role === "host") {
    return [
      ...base,
      "Host rule: use this channel goal to decide whether to answer, route, stay quiet, ask for clarification, or record review evidence.",
      "Bot-message gate: process bot messages only when they belong to an active discussion, follow a logged direct-expert mention, explicitly mention the host agent, or are needed for review evidence; otherwise stay silent."
    ].join("\n");
  }

  return [
    ...base,
    "Expert rule: use this channel goal to decide whether your domain expertise is relevant. Do not route, summon, or moderate other agents unless explicitly assigned. Answer only when mentioned, directly assigned by the host agent, or clearly responsible for the topic; otherwise stay quiet."
  ].join("\n");
}

function assertGoals(goals) {
  const seen = new Set();
  if (!goals.review?.cadenceDays || !goals.review?.statsPath || !goals.review?.template) {
    throw new Error("Missing review.cadenceDays, review.statsPath, or review.template");
  }
  for (const group of goals.groups ?? []) {
    for (const field of ["slug", "name", "channelId", "doc", "oneLineGoal", "northStar"]) {
      if (!group[field]) throw new Error(`Missing ${field} for group ${group.slug ?? "<unknown>"}`);
    }
    if (seen.has(group.channelId)) throw new Error(`Duplicate channelId ${group.channelId}`);
    seen.add(group.channelId);
    if (!Array.isArray(group.operatingMetrics) || group.operatingMetrics.length !== 2) {
      throw new Error(`${group.slug} must have exactly 2 operatingMetrics`);
    }
    if (!Array.isArray(group.guardrailMetrics) || group.guardrailMetrics.length !== 2) {
      throw new Error(`${group.slug} must have exactly 2 guardrailMetrics`);
    }
  }
}

function ensureWildcardGuild(entry) {
  entry.guilds ??= {};
  entry.guilds["*"] ??= {};
  entry.guilds["*"].channels ??= {};
  return entry.guilds["*"].channels;
}

function applyGoalsToOpenClaw(config, goals) {
  const hostAccountId = configuredHostAccountId(config);
  const hostPrompts = Object.fromEntries(
    goals.groups.map((group) => [group.channelId, buildSystemPrompt(group, goals.review, "host")])
  );
  const expertPrompts = Object.fromEntries(
    goals.groups.map((group) => [group.channelId, buildSystemPrompt(group, goals.review, "expert")])
  );
  const discord = config.channels?.discord;
  if (!discord) throw new Error("openclaw.json is missing channels.discord");

  const globalChannels = ensureWildcardGuild(discord);
  for (const [channelId, systemPrompt] of Object.entries(hostPrompts)) {
    globalChannels[channelId] = {
      ...(globalChannels[channelId] ?? {}),
      systemPrompt
    };
  }

  for (const [accountId, account] of Object.entries(discord.accounts ?? {})) {
    if (accountId === "default" || !account || typeof account !== "object") continue;
    const prompts = accountId === hostAccountId ? hostPrompts : expertPrompts;
    const accountChannels = ensureWildcardGuild(account);
    for (const [channelId, systemPrompt] of Object.entries(prompts)) {
      accountChannels[channelId] = {
        ...(accountChannels[channelId] ?? {}),
        systemPrompt
      };
    }
  }
}

function validateDocs(root, goals) {
  const errors = [];
  for (const group of goals.groups) {
    const docPath = resolve(root, group.doc);
    let text = "";
    try {
      text = readFileSync(docPath, "utf8");
    } catch {
      errors.push(`${group.slug}: missing doc ${group.doc}`);
      continue;
    }
    for (const value of [
      group.channelId,
      group.oneLineGoal,
      group.northStar,
      ...group.operatingMetrics,
      ...group.guardrailMetrics
    ]) {
      if (!text.includes(value)) errors.push(`${group.slug}: doc does not include "${value}"`);
    }
  }
  return errors;
}

export function syncGroupGoals(root = repoRoot, options = {}) {
  const goalsPath = resolve(root, "workspace/groups/company-goals.json");
  const openclawPath = resolve(root, "openclaw.json");
  const checkOnly = options.checkOnly === true;
  const goals = readJson(goalsPath);
  assertGoals(goals);

  const config = readJson(openclawPath);
  const before = JSON.stringify(config);
  applyGoalsToOpenClaw(config, goals);
  const after = JSON.stringify(config);
  const docErrors = validateDocs(root, goals);

  const errors = [];
  if (checkOnly && before !== after) errors.push("openclaw.json is not synced with workspace/groups/company-goals.json");
  errors.push(...docErrors);
  if (errors.length > 0) return { ok: false, groups: goals.groups.length, errors };

  if (!checkOnly) {
    writeFileSync(openclawPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  return { ok: true, groups: goals.groups.length, errors: [] };
}

export function runCli(argv = process.argv.slice(2), root = repoRoot) {
  const checkOnly = argv.includes("--check");
  const report = syncGroupGoals(root, { checkOnly });
  if (!report.ok) {
    console.error(report.errors.join("\n"));
    process.exit(1);
  }
  console.log(checkOnly ? `Group goals synced: ${report.groups} groups` : `Synced ${report.groups} group goals into openclaw.json`);
}

/* c8 ignore next 3 */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
