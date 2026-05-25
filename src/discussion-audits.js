#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();

export const VALID_WORK_TYPES = new Set([
  "qa",
  "discussion",
  "research",
  "ops-change",
  "diagnostic",
  "participation",
  "scheduled",
  "silent-record"
]);
export const VALID_SURFACES = new Set(["channel", "thread"]);
export const VALID_COLLABORATIONS = new Set(["none", "single-owner", "sequential", "parallel"]);
export const HOSTED_WORK_TYPES = new Set(["discussion", "research", "participation"]);
export const SUCCESS_KIND_BY_WORK_TYPE = {
  discussion: "hosted-discussion",
  research: "research-brief",
  participation: "participation-event"
};
export const VALID_PARTICIPANT_STATUSES = new Set([
  "pending",
  "assigned",
  "sent",
  "failed",
  "timed_out",
  "skipped"
]);
export const VALID_VISIBLE_ARTIFACTS = new Set([
  "synthesis",
  "host-summary",
  "evidence-backed-answer",
  "decision",
  "next-action"
]);

const DEFAULT_DISCUSSIONS_DIR = "workspace/groups/discussions";
const DEFAULT_SHADOW_ROOT = "workspace/agents";
const DEFAULT_CONTRACT_DOC = "workspace/groups/communication-contracts.md";
const DEFAULT_TEMPLATE = "workspace/groups/discussions/TEMPLATE.json";
const DEFAULT_DEPRECATED_PATTERNS = [
  { label: "visible or template contest state block", re: new RegExp("contest" + "_state") },
  { label: "old reply_format contract", re: /reply_format/ }
];

function rel(root, path) {
  return relative(root, path) || ".";
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listFiles(dir, predicate = () => true) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === ".gitkeep" || entry.startsWith("._")) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...listFiles(path, predicate));
    else if (predicate(path)) out.push(path);
  }
  return out.sort();
}

function listDirs(dir, predicate = () => true) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (predicate(path)) out.push(path);
      out.push(...listDirs(path, predicate));
    }
  }
  return out.sort();
}

function pushIssue(issues, root, severity, path, message, extra = {}) {
  issues.push({ severity, path: rel(root, path), message, ...extra });
}

function parseJsonl(path, root, issues) {
  const events = [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      events.push({ ...JSON.parse(line), __source: path, __line: index + 1 });
    } catch (error) {
      pushIssue(issues, root, "error", path, `invalid JSONL: ${error.message}`, { line: index + 1 });
    }
  }
  return events;
}

function eventKey(event) {
  if (event.stateId) return `state:${event.stateId}`;
  if (event.threadId) return `thread:${event.threadId}`;
  return `message:${event.messageId}`;
}

function isDirectExpert(event) {
  return event.workType === "silent-record" || event.class === "direct-expert" || event.mode === "direct-expert" || event.stateId === null;
}

function isOpeningEvent(event) {
  return ["host-opened", "opened", "assigned", "thread-created", "followup-asked"].includes(event.type);
}

function isClosingEvent(event) {
  return ["summarized", "closed", "timed-out", "unanswered-at-review"].includes(event.type);
}

function requiredStateFields() {
  return [
    "id",
    "workType",
    "surface",
    "collaboration",
    "groupSlug",
    "channelId",
    "originMessageId",
    "question",
    "expectedOutput",
    "status",
    "openedAt",
    "lastActivityAt"
  ];
}

function pushInvalidEnum(root, issues, path, field, value, allowed) {
  if (allowed.has(value)) return;
  pushIssue(issues, root, "error", path, `${field} has unsupported value ${JSON.stringify(value)}`);
}

export function auditCommonDiscussionStateFields(state, path, root = repoRoot, issues = []) {
  for (const field of requiredStateFields()) {
    if (state[field] === undefined || state[field] === null || state[field] === "") {
      pushIssue(issues, root, "error", path, `state missing ${field}`);
    }
  }
  pushInvalidEnum(root, issues, path, "workType", state.workType, VALID_WORK_TYPES);
  pushInvalidEnum(root, issues, path, "surface", state.surface, VALID_SURFACES);
  pushInvalidEnum(root, issues, path, "collaboration", state.collaboration, VALID_COLLABORATIONS);
  if (state.class !== undefined) {
    pushIssue(issues, root, "warning", path, "state uses deprecated class field; use workType instead");
  }
  if (state.mode !== undefined) {
    pushIssue(issues, root, "warning", path, "state uses deprecated mode field; use collaboration/surface instead");
  }
  if (state.surface === "thread" && !state.threadId) {
    pushIssue(issues, root, "error", path, "thread surface requires threadId");
  }
  if (state.collaboration === "sequential" && (!Array.isArray(state.ownerQueue) || state.ownerQueue.length === 0)) {
    pushIssue(issues, root, "error", path, "sequential collaboration requires ownerQueue");
  }
  if ((state.collaboration === "sequential" || state.collaboration === "single-owner") && !state.currentOwner) {
    pushIssue(issues, root, "error", path, `${state.collaboration} collaboration requires currentOwner`);
  }
  return issues;
}

export function auditHostedContract(state, path, root = repoRoot, issues = []) {
  if (!HOSTED_WORK_TYPES.has(state.workType)) return issues;

  const expectedKind = SUCCESS_KIND_BY_WORK_TYPE[state.workType];
  if (!state.successCriteria || typeof state.successCriteria !== "object") {
    pushIssue(issues, root, "error", path, `${state.workType} state missing successCriteria`);
  } else {
    if (state.successCriteria.kind !== expectedKind) {
      pushIssue(
        issues,
        root,
        "error",
        path,
        `${state.workType} successCriteria.kind must be ${expectedKind}, got ${JSON.stringify(state.successCriteria.kind)}`
      );
    }
    if (!VALID_VISIBLE_ARTIFACTS.has(state.successCriteria.requiredVisibleArtifact)) {
      pushIssue(
        issues,
        root,
        "error",
        path,
        `unsupported requiredVisibleArtifact ${JSON.stringify(state.successCriteria.requiredVisibleArtifact)}`
      );
    }
  }

  if (state.workType === "participation") {
    if (!state.delivery || state.delivery.required !== "message_tool" || state.delivery.visibleMessageRequired !== true) {
      pushIssue(issues, root, "error", path, "participation state requires delivery.required=message_tool and visibleMessageRequired=true");
    }
    auditParticipants(state, path, root, issues);
  }

  if (state.workType === "discussion") {
    if (!state.expectedOutput || !/(synthesis|decision|next|summary|结论|决策|下一步|总结)/i.test(state.expectedOutput)) {
      pushIssue(issues, root, "warning", path, "discussion expectedOutput should name synthesis, decision, summary, or next action");
    }
  }

  if (state.workType === "research") {
    if (!state.evidence || state.evidence.required !== true) {
      pushIssue(issues, root, "error", path, "research state requires evidence.required=true");
    }
    if (!state.evidence || typeof state.evidence.minimumSources !== "number") {
      pushIssue(issues, root, "error", path, "research state requires evidence.minimumSources");
    }
    if (!state.evidence || !state.evidence.sourcePolicy) {
      pushIssue(issues, root, "error", path, "research state requires evidence.sourcePolicy");
    }
  }

  return issues;
}

function auditParticipants(state, path, root, issues) {
  if (!Array.isArray(state.participants) || state.participants.length === 0) {
    pushIssue(issues, root, "error", path, `${state.workType} state requires participant objects`);
    return;
  }
  for (const [index, participant] of state.participants.entries()) {
    if (!participant || typeof participant !== "object" || Array.isArray(participant)) {
      pushIssue(issues, root, "error", path, `participants[${index}] must be an object`);
      continue;
    }
    for (const field of ["agentId", "name", "mention", "status"]) {
      if (!participant[field]) pushIssue(issues, root, "error", path, `participants[${index}] missing ${field}`);
    }
    if (participant.status && !VALID_PARTICIPANT_STATUSES.has(participant.status)) {
      pushIssue(issues, root, "error", path, `participants[${index}] has invalid status ${participant.status}`);
    }
    if (participant.status === "sent" && !participant.messageId) {
      pushIssue(issues, root, "error", path, `participants[${index}] is sent but missing messageId`);
    }
  }
}

export function auditDiscussionLifecycle(root = repoRoot, options = {}) {
  const issues = [];
  const discussionsDir = resolve(root, options.discussionsDir ?? DEFAULT_DISCUSSIONS_DIR);
  const activeFiles = listFiles(resolve(discussionsDir, "active"), (path) => extname(path) === ".json");
  const archiveFiles = listFiles(resolve(discussionsDir, "archive"), (path) => extname(path) === ".json");
  const eventFiles = listFiles(resolve(discussionsDir, "events"), (path) => extname(path) === ".jsonl");
  const activeStates = new Map();
  const archivedStates = new Map();
  const now = Date.now();

  for (const path of activeFiles) {
    const state = readJson(path);
    activeStates.set(state.id, { state, path });
    auditCommonDiscussionStateFields(state, path, root, issues);
    if (state.status !== "open") {
      pushIssue(issues, root, "error", path, `active state has non-open status ${state.status}`);
    }
    if (state.contest_state !== undefined) {
      pushIssue(issues, root, "error", path, "active state contains deprecated contest_state block");
    }
    if (state.deadlineAt && Date.parse(state.deadlineAt) < now) {
      pushIssue(issues, root, "warning", path, `active state deadline is past: ${state.deadlineAt}`);
    }
  }

  for (const path of archiveFiles) {
    const state = readJson(path);
    archivedStates.set(state.id, { state, path });
    auditCommonDiscussionStateFields(state, path, root, issues);
    if (state.status !== "closed") {
      pushIssue(issues, root, "error", path, `archived state must be closed, got ${state.status}`);
    }
  }

  const events = eventFiles.flatMap((path) => parseJsonl(path, root, issues));
  const closeByKey = new Map();
  for (const event of events.filter(isClosingEvent)) {
    const key = eventKey(event);
    if (!closeByKey.has(key)) closeByKey.set(key, []);
    closeByKey.get(key).push(event);
  }

  for (const event of events.filter(isOpeningEvent)) {
    if (isDirectExpert(event)) continue;
    const key = eventKey(event);
    const stateKnown = event.stateId ? activeStates.has(event.stateId) || archivedStates.has(event.stateId) : true;
    const closed = closeByKey.has(key);
    if (event.stateId && !stateKnown) {
      pushIssue(issues, root, "error", event.__source, `opening event references missing stateId ${event.stateId}`, { line: event.__line });
    }
    if (!event.stateId) {
      pushIssue(
        issues,
        root,
        "error",
        event.__source,
        `${event.type} event must carry stateId unless it is direct-expert event-only flow`,
        { line: event.__line }
      );
    } else if (!activeStates.has(event.stateId) && !closed) {
      pushIssue(
        issues,
        root,
        "error",
        event.__source,
        `${event.type} for ${event.stateId} has no active state and no close/summarize event`,
        { line: event.__line }
      );
    }
  }

  return {
    activeStates: activeStates.size,
    archivedStates: archivedStates.size,
    eventFiles: eventFiles.length,
    events: events.length,
    issues
  };
}

export function auditCommunicationContracts(root = repoRoot, options = {}) {
  const issues = [];
  const discussionsDir = resolve(root, options.discussionsDir ?? DEFAULT_DISCUSSIONS_DIR);
  const activeFiles = listFiles(resolve(discussionsDir, "active"), (path) => extname(path) === ".json");
  const templatePath = resolve(root, options.templatePath ?? DEFAULT_TEMPLATE);
  const contractPath = resolve(root, options.contractPath ?? DEFAULT_CONTRACT_DOC);
  const shadowRoot = resolve(root, options.shadowRoot ?? DEFAULT_SHADOW_ROOT);

  if (!existsSync(contractPath)) {
    pushIssue(issues, root, "error", contractPath, "communication contract document is missing");
  } else {
    const text = readFileSync(contractPath, "utf8");
    for (const marker of ["Participation Event", "Hosted Discussion", "Research / Evidence Work"]) {
      if (!text.includes(marker)) pushIssue(issues, root, "error", contractPath, `missing ${marker} section`);
    }
  }

  const shadowDirs = listDirs(shadowRoot, (path) =>
    /workspace[\\/]groups[\\/]discussions$/.test(path)
  );
  for (const path of shadowDirs) {
    pushIssue(issues, root, "error", path, "agent-private shadow discussions directory must not exist");
  }

  if (existsSync(templatePath)) {
    const template = readJson(templatePath);
    auditHostedContract({ ...template, workType: "discussion" }, templatePath, root, issues);
  } else {
    pushIssue(issues, root, "error", templatePath, "discussion template is missing");
  }

  for (const path of activeFiles) {
    const state = readJson(path);
    auditHostedContract(state, path, root, issues);
  }

  return { activeStates: activeFiles.length, issues };
}

export function auditGroupOrchestrationRules(root = repoRoot, options = {}) {
  const issues = [];
  const scanRoots = options.scanRoots ?? [
    "workspace/AGENTS.md",
    "workspace/groups",
    "workspace/agents"
  ];
  const ignoredPathParts = new Set(options.ignoredPathParts ?? [
    ".openclaw",
    ".clawhub",
    "sessions",
    "active",
    "archive",
    "events"
  ]);
  const textExtensions = new Set(options.textExtensions ?? [".md", ".mjs", ".js", ".json"]);
  const forbiddenPatterns = options.forbiddenPatterns ?? DEFAULT_DEPRECATED_PATTERNS;

  function extension(path) {
    const index = path.lastIndexOf(".");
    return index === -1 ? "" : path.slice(index);
  }

  function shouldIgnore(path) {
    const parts = rel(root, path).split(/[\\/]/);
    return parts.some((part) => ignoredPathParts.has(part));
  }

  function collectFiles(path, files = []) {
    if (!existsSync(path) || shouldIgnore(path)) return files;
    const stats = statSync(path);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(path)) collectFiles(resolve(path, entry), files);
      return files;
    }
    if (stats.isFile() && textExtensions.has(extension(path))) files.push(path);
    return files;
  }

  const files = [];
  for (const scanRoot of scanRoots) collectFiles(resolve(root, scanRoot), files);

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const pattern of forbiddenPatterns) {
      if (pattern.re.test(text)) {
        pushIssue(issues, root, "error", file, pattern.label);
      }
    }
  }

  return { files: files.length, issues };
}

function printIssues(issues) {
  for (const issue of issues) {
    const location = issue.line ? `${issue.path}:${issue.line}` : issue.path;
    const stream = issue.severity === "error" ? console.error : console.log;
    stream(`- ${issue.severity}: ${location}: ${issue.message}`);
  }
}

export function runDiscussionLifecycleCli(argv = process.argv.slice(2), root = repoRoot) {
  const report = auditDiscussionLifecycle(root);
  if (argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Active states: ${report.activeStates}`);
    console.log(`Archived states: ${report.archivedStates}`);
    console.log(`Event files: ${report.eventFiles}`);
    console.log(`Events: ${report.events}`);
    if (report.issues.length) {
      console.log("Issues:");
      printIssues(report.issues);
    } else {
      console.log("Discussion lifecycle audit passed");
    }
  }
  if (report.issues.some((issue) => issue.severity === "error")) process.exit(1);
}

export function runCommunicationContractsCli(argv = process.argv.slice(2), root = repoRoot) {
  const report = auditCommunicationContracts(root);
  if (argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Active states checked: ${report.activeStates}`);
    if (report.issues.length) {
      console.log("Issues:");
      printIssues(report.issues);
    } else {
      console.log("Communication contract audit passed");
    }
  }
  if (report.issues.some((issue) => issue.severity === "error")) process.exit(1);
}

export function runGroupOrchestrationRulesCli(argv = process.argv.slice(2), root = repoRoot) {
  const report = auditGroupOrchestrationRules(root);
  if (argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.issues.length) {
    console.error("Group orchestration rules audit failed:");
    printIssues(report.issues);
  } else {
    console.log(`Group orchestration rules audit passed: ${report.files} files`);
  }
  if (report.issues.some((issue) => issue.severity === "error")) process.exit(1);
}

export function runCli(argv = process.argv.slice(2), root = repoRoot) {
  const mode = argv[0] ?? "discussion-lifecycle";
  const rest = argv.slice(1);
  if (mode === "discussion-lifecycle") return runDiscussionLifecycleCli(rest, root);
  if (mode === "communication-contracts") return runCommunicationContractsCli(rest, root);
  if (mode === "group-orchestration-rules") return runGroupOrchestrationRulesCli(rest, root);
  console.error(`Unknown discussion audit mode: ${mode}`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
