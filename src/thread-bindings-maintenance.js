#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function pruneExpiredDiscordThreadBindings(root = repoRoot, options = {}) {
  const bindingsPath = resolve(root, "discord/thread-bindings.json");
  const now = Number(options.nowMs ?? process.env.NOW_MS ?? Date.now());
  const checkOnly = options.checkOnly === true;
  const data = readJson(bindingsPath, { version: 1, bindings: {} });
  const bindings = data.bindings && typeof data.bindings === "object" ? data.bindings : {};
  const kept = {};
  const removed = [];

  for (const [key, binding] of Object.entries(bindings)) {
    if (isExpiredAt(binding, now)) {
      removed.push(key);
    } else {
      kept[key] = binding;
    }
  }

  if (!checkOnly && removed.length > 0) {
    writeFileSync(bindingsPath, `${JSON.stringify({ ...data, bindings: kept }, null, 2)}\n`);
  }

  return { checked: Object.keys(bindings).length, removed };
}

function isExpiredAt(binding, nowMs) {
  const lastActivityAt = Number(binding?.lastActivityAt ?? binding?.boundAt ?? 0);
  const boundAt = Number(binding?.boundAt ?? 0);
  const idleTimeoutMs = Number(binding?.idleTimeoutMs ?? 0);
  const maxAgeMs = Number(binding?.maxAgeMs ?? 0);
  if (idleTimeoutMs > 0 && lastActivityAt > 0 && nowMs - lastActivityAt > idleTimeoutMs) return true;
  if (maxAgeMs > 0 && boundAt > 0 && nowMs - boundAt > maxAgeMs) return true;
  return false;
}

export function runCli(argv = process.argv.slice(2), root = repoRoot) {
  const checkOnly = argv.includes("--check");
  const report = pruneExpiredDiscordThreadBindings(root, { checkOnly });

  console.log(`Discord thread bindings checked: ${report.checked}`);
  console.log(`Expired bindings ${checkOnly ? "found" : "removed"}: ${report.removed.length}`);
  for (const key of report.removed) console.log(`- ${key}`);
  if (checkOnly && report.removed.length > 0) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
