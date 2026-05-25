#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalizeChannelTarget(value) {
  const match = String(value ?? "").match(/^channel:(\d+)$/);
  return match?.[1];
}

function sessionKeyChannel(value) {
  const match = String(value ?? "").match(/:discord:channel:(\d+)(?::|$)/);
  return match?.[1];
}

function listPendingOnboardingChannels(root, config) {
  const configuredDir = config.plugins?.entries?.clawclave?.config?.onboardingDir ?? "workspace/groups/onboarding/active";
  const onboardingDir = resolve(root, configuredDir);
  if (!existsSync(onboardingDir)) return new Set();

  const pending = new Set();
  for (const entry of readdirSync(onboardingDir)) {
    if (!entry.endsWith(".json")) continue;
    const path = join(onboardingDir, entry);
    const state = readJson(path, null);
    if (state?.status === "pending_goal" && state.channelId) pending.add(String(state.channelId));
  }
  return pending;
}

function assertCronTargets({ issues, jobs, knownChannels, pendingChannels }) {
  const enabledTargetsByChannel = new Map();

  for (const job of jobs) {
    if (!job?.enabled) continue;
    const targets = new Set();
    const deliveryTarget = normalizeChannelTarget(job.delivery?.to);
    const sessionTarget = sessionKeyChannel(job.sessionKey);
    if (deliveryTarget) targets.add(deliveryTarget);
    if (sessionTarget) targets.add(sessionTarget);

    for (const channelId of targets) {
      if (!knownChannels.has(channelId)) {
        issues.push(`cron/jobs.json: enabled job ${job.id} (${job.name}) references channel ${channelId}, but it is not in workspace/groups/company-goals.json`);
      }
      if (pendingChannels.has(channelId)) {
        issues.push(`cron/jobs.json: enabled job ${job.id} (${job.name}) references pending_goal channel ${channelId}`);
      }
    }

    if (deliveryTarget) {
      enabledTargetsByChannel.set(deliveryTarget, (enabledTargetsByChannel.get(deliveryTarget) ?? 0) + 1);
    }
  }

  const humorChannel = "1479019535532163195";
  const humorEnabled = enabledTargetsByChannel.get(humorChannel) ?? 0;
  if (humorEnabled > 1) {
    issues.push(`cron/jobs.json: hahaha-lte-pte has ${humorEnabled} enabled scheduled broadcasts; non-contest humor should have at most 1`);
  }
}

function assertSp500Shape({ issues, jobs }) {
  const sp500Channel = "1478086002630328501";
  const required = [/假设|hypothesis/i, /证据|evidence/i, /风险|risk/i, /行动|next action|下一步/i, /owner|负责人|复盘|review/i];

  for (const job of jobs) {
    if (!job?.enabled) continue;
    if (normalizeChannelTarget(job.delivery?.to) !== sp500Channel) continue;
    const message = String(job.payload?.message ?? "");
    for (const pattern of required) {
      if (!pattern.test(message)) {
        issues.push(`cron/jobs.json: S&P500 job ${job.id} (${job.name}) prompt is missing required investment-hypothesis field ${pattern}`);
      }
    }
  }
}

function assertClawclaveConfig({ issues, config }) {
  const entry = config.plugins?.entries?.clawclave;
  if (!entry?.enabled) {
    issues.push("openclaw.json: clawclave plugin must be enabled for group goal/onboarding/runtime context");
    return;
  }
  const pluginConfig = entry.config ?? {};
  for (const field of ["goalsFile", "onboardingDir", "eventsDir", "hostedTurnsDir"]) {
    if (!pluginConfig[field]) issues.push(`openclaw.json: clawclave config is missing ${field}`);
  }
  if (pluginConfig.onboarding !== true) {
    issues.push("openclaw.json: clawclave onboarding must stay enabled");
  }
  if (pluginConfig.transcriptWriter !== true) {
    issues.push("openclaw.json: clawclave transcriptWriter must stay enabled");
  }
}

export function auditDiscordGroupRuntime(root = repoRoot) {
  const configPath = resolve(root, "openclaw.json");
  const jobsPath = resolve(root, "cron/jobs.json");
  const goalsPath = resolve(root, "workspace/groups/company-goals.json");

  const config = readJson(configPath, {});
  const jobs = readJson(jobsPath, { jobs: [] }).jobs ?? [];
  const goals = readJson(goalsPath, { groups: [] });
  const knownChannels = new Set((goals.groups ?? []).map((group) => String(group.channelId)).filter(Boolean));
  const pendingChannels = listPendingOnboardingChannels(root, config);
  const issues = [];

  assertClawclaveConfig({ issues, config });
  assertCronTargets({ issues, jobs, knownChannels, pendingChannels });
  assertSp500Shape({ issues, jobs });

  return {
    knownChannels: knownChannels.size,
    enabledJobs: jobs.filter((job) => job?.enabled).length,
    pendingChannels: pendingChannels.size,
    issues
  };
}

export function runCli(argv = process.argv.slice(2), root = repoRoot) {
  const report = auditDiscordGroupRuntime(root);

  if (argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Known group channels: ${report.knownChannels}`);
    console.log(`Enabled cron jobs: ${report.enabledJobs}`);
    console.log(`Pending onboarding channels: ${report.pendingChannels}`);
    if (report.issues.length) {
      console.error("Discord group runtime audit failed:");
      for (const issue of report.issues) console.error(`- ${issue}`);
    } else {
      console.log("Discord group runtime audit passed");
    }
  }
  if (report.issues.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
