#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_TURN_DIR = "memory/openclaw/turns";
const DEFAULT_AGENT_WORKSPACE_DIR = "workspace/agents";
const DEFAULT_LIMIT = 200;
const FEEDBACK_RE = /(不对|错误|失败|没反应|没有回复|挂了|可以|好了|符合预期|不错|修复|为什么|root cause|根因|bug|error|failed|works?|good)/i;
const SECRET_PATTERNS = [
  /\b(Bot|Bearer)\s+[A-Za-z0-9._~+/=-]{16,}\b/g,
  /\b(?:sk|sk-proj|sk-ant|ghp|github_pat)_[A-Za-z0-9_]{12,}\b/g,
  /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{27,}\b/g
];

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "bigint") return String(value);
  }
  return undefined;
}

function readJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function redact(value) {
  let text = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[REDACTED_SECRET]");
  return text;
}

function preview(value, limit = 220) {
  const text = redact(value).replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function walkJsonl(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) walkJsonl(path, files);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
  }
  return files;
}

export function listAgentIds(root, options = {}) {
  const agentsDir = resolve(root, options.agentWorkspaceDir ?? DEFAULT_AGENT_WORKSPACE_DIR);
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function readAgentTurnRecords(root, agentId, options = {}) {
  const turnDir = options.turnDir ?? options.memoryDir ?? DEFAULT_TURN_DIR;
  const dir = resolve(root, turnDir, "discord/accounts", agentId);
  const records = [];
  for (const file of walkJsonl(dir)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const record = readJsonLine(line);
      if (!record) continue;
      records.push({ ...record, sourceFile: file });
    }
  }
  records.sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")));
  const limit = Number.isInteger(options.limit) ? options.limit : DEFAULT_LIMIT;
  return limit > 0 ? records.slice(-limit) : records;
}

function summarizeRecords(agentId, records) {
  const channels = new Set();
  const sessions = new Set();
  const feedback = [];
  const outputs = [];
  const errors = [];

  for (const record of records) {
    if (record.channelId) channels.add(record.channelId);
    if (record.sessionKey) sessions.add(record.sessionKey);
    const content = firstString(record.content, record.prompt, record.body);
    if (content && FEEDBACK_RE.test(content)) feedback.push(record);
    if (record.direction === "outbound" || record.phase === "output_intent" || record.phase === "output_result") outputs.push(record);
    if (record.outcome?.error || /error|failed|timeout/i.test(JSON.stringify(record.outcome ?? ""))) errors.push(record);
  }

  const latest = records.at(-1);
  const lines = [
    `# ${agentId} Memory Distillation Candidate`,
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Reviewed: false`,
    "",
    "## Scope",
    "",
    `- Source: memory/openclaw/turns/discord/accounts/${agentId}/`,
    `- Records scanned: ${records.length}`,
    `- Sessions touched: ${sessions.size}`,
    `- Channels touched: ${channels.size}`,
    latest?.timestamp ? `- Latest record: ${latest.timestamp}` : "- Latest record: none",
    "",
    "## Candidate Signals",
    "",
    ...feedback.slice(-12).map((record) => `- ${record.timestamp ?? "unknown"} ${record.phase ?? record.direction ?? "turn"}: ${preview(record.content)}`),
    feedback.length === 0 ? "- No obvious feedback signals found." : "",
    "",
    "## Recent Outputs",
    "",
    ...outputs.slice(-8).map((record) => `- ${record.timestamp ?? "unknown"} ${record.phase ?? "output"}: ${preview(record.content)}`),
    outputs.length === 0 ? "- No recent output records found." : "",
    "",
    "## Reliability Notes",
    "",
    ...errors.slice(-8).map((record) => `- ${record.timestamp ?? "unknown"} ${record.phase ?? "turn"}: ${preview(JSON.stringify(record.outcome ?? {}))}`),
    errors.length === 0 ? "- No recorded error outcomes found." : "",
    "",
    "## Promotion Rule",
    "",
    "- Promote only stable user preferences, repeated failure lessons, or durable domain facts into MEMORY.md.",
    "- Do not promote raw secrets, one-off debug traces, or stale incident details.",
    ""
  ];
  return lines.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");
}

export function distillAgentMemory(root, agentId, options = {}) {
  const records = readAgentTurnRecords(root, agentId, options);
  const date = (options.date ?? new Date().toISOString()).slice(0, 10);
  const outputDir = resolve(root, options.agentWorkspaceDir ?? DEFAULT_AGENT_WORKSPACE_DIR, agentId, "memory/distilled");
  const outputFile = resolve(outputDir, `${date}.md`);
  mkdirSync(dirname(outputFile), { recursive: true });
  const text = summarizeRecords(agentId, records);
  writeFileSync(outputFile, text);
  return {
    agentId,
    records: records.length,
    outputFile
  };
}

export function distillAllAgentMemories(root, options = {}) {
  const agentIds = options.agentIds?.length ? options.agentIds : listAgentIds(root, options);
  return agentIds.map((agentId) => distillAgentMemory(root, agentId, options));
}

export function runCli(args = process.argv.slice(2), root = process.cwd()) {
  const agentIds = [];
  let limit = DEFAULT_LIMIT;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--agent") agentIds.push(args[++index]);
    else if (arg === "--limit") limit = Number.parseInt(args[++index], 10);
    else if (arg === "--all") continue;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: clawclave distill-agent-memory [--all] [--agent <id>] [--limit <n>]");
      return;
    } else {
      agentIds.push(arg);
    }
  }
  const results = distillAllAgentMemories(root, { agentIds: agentIds.filter(Boolean), limit });
  for (const result of results) {
    console.log(`${result.agentId}: ${result.records} records -> ${result.outputFile}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) runCli();
