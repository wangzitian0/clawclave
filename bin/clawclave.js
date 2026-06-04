#!/usr/bin/env node
const command = process.argv[2];
const args = process.argv.slice(3);

const commands = {
  "group-workspace": "../src/group-workspace.js",
  "sync-group-goals": "../src/sync-group-goals.js",
  "onboard-discord-group": "../src/onboard-discord-group.js",
  "audit-discord-group-runtime": "../src/audit-discord-group-runtime.js",
  "audit-discussion-lifecycle": "../src/audit-discussion-lifecycle.js",
  "audit-communication-contracts": "../src/audit-communication-contracts.js",
  "audit-group-orchestration-rules": "../src/audit-group-orchestration-rules.js",
  "self-check": "../src/self-check.js",
  "prune-expired-discord-thread-bindings": "../src/thread-bindings-maintenance.js",
  "distill-agent-memory": "../src/agent-memory-distillation.js"
};

function usage() {
  return `Usage: clawclave <command> [args]

Commands:
  group-workspace
  sync-group-goals
  onboard-discord-group
  audit-discord-group-runtime
  audit-discussion-lifecycle
  audit-communication-contracts
  audit-group-orchestration-rules
  self-check
  prune-expired-discord-thread-bindings
  distill-agent-memory
`;
}

if (!command || command === "--help" || command === "-h") {
  console.log(usage());
  process.exit(0);
}

const modulePath = commands[command];
if (!modulePath) {
  console.error(`Unknown command: ${command}`);
  console.error("");
  console.error(usage());
  process.exit(1);
}

const mod = await import(new URL(modulePath, import.meta.url));
if (typeof mod.runCli !== "function") {
  console.error(`Command has no runCli export: ${command}`);
  process.exit(1);
}

mod.runCli(args, process.cwd());
