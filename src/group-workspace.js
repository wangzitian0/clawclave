#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = process.cwd();
const REQUIRED_GROUP_FILES = [
  "IDENTITY.md",
  "SOUL.md",
  "USER.md",
  "AGENTS.md",
  "MEMORY.md",
  "HEARTBEAT.md"
];
const SHARED_GROUP_CONTEXT_FILES = [
  "workspace/AGENTS.md",
  "workspace/groups/communication-contracts.md",
  "workspace/groups/interaction-taxonomy.md",
  "workspace/groups/discussions/README.md"
];
const DEFAULT_TRANSCRIPT_TAIL_EVENTS = 12;
const REQUIRED_MESSAGE_FIELDS = ["messageId", "channelId", "authorType", "content", "direction"];
const DISCORD_LEDGER_DIR = "memory/discord/ledger";
const DISCORD_MEMORY_DIR = "memory/discord";
const DISCORD_THREAD_CHANNEL_TYPES = new Set([
  "GUILD_NEWS_THREAD",
  "GUILD_PUBLIC_THREAD",
  "GUILD_PRIVATE_THREAD",
  "ANNOUNCEMENT_THREAD",
  "PUBLIC_THREAD",
  "PRIVATE_THREAD",
  "10",
  "11",
  "12",
  10,
  11,
  12
]);
const DISCORD_FORUM_CHANNEL_TYPES = new Set(["GUILD_FORUM", "GUILD_MEDIA", "15", "16", 15, 16]);
const DISCORD_DM_CHANNEL_TYPES = new Set(["DM", "GROUP_DM", "1", "3", 1, 3]);
const SENSITIVE_KEY_RE = /(?:token|secret|password|credential|authorization|authProfile|auth_profile)/i;
const SECRET_PATTERNS = [
  /\b(Bot|Bearer)\s+[A-Za-z0-9._~+/=-]{16,}\b/g,
  /\b(?:sk|sk-proj|sk-ant|ghp|github_pat)_[A-Za-z0-9_]{12,}\b/g,
  /\b(?:xoxb|xoxp|xoxa)-[A-Za-z0-9-]{12,}\b/g,
  /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{27,}\b/g
];

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadGoals(root = repoRoot) {
  return readJson(resolve(root, "workspace/groups/company-goals.json"));
}

export function getGroupDir(root, group) {
  return resolve(root, "workspace/groups", group.slug);
}

export function resolveGroup(goals, { slug, channelId }) {
  if (slug) return goals.groups.find((group) => group.slug === slug);
  if (channelId) return goals.groups.find((group) => group.channelId === channelId);
  return undefined;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" || typeof value === "bigint") return String(value);
  }
  return undefined;
}

function normalizeDiscordId(value, { allowUserAlias = false } = {}) {
  const text = firstString(value);
  if (!text) return undefined;
  const normalized = text.trim();
  const channelMatch = normalized.match(/^channel[:-](\d+)$/);
  if (channelMatch) return channelMatch[1];
  if (allowUserAlias) {
    const userMatch = normalized.match(/^user[:-](\d+)$/);
    if (userMatch) return userMatch[1];
  }
  return normalized;
}

function firstTimestamp(...values) {
  for (const value of values) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    if (typeof value === "number" && Number.isFinite(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    if (typeof value === "string" && value.trim()) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }
  return undefined;
}

export function resolveGroupFromContext(goals, context = {}) {
  const message = context.message ?? context.discordMessage ?? context.rawMessage ?? {};
  const channel = context.channel ?? message.channel ?? {};
  const thread = context.thread ?? message.thread ?? {};
  const session = context.session ?? {};
  const metadata = context.metadata ?? session.metadata ?? {};

  const slug = firstString(
    context.groupSlug,
    context.group?.slug,
    metadata.groupSlug,
    session.groupSlug
  );
  const directChannelId = normalizeDiscordId(
    firstString(
      context.channelId,
      context.channel_id,
      metadata.channelId,
      message.channelId,
      message.channel_id,
      message.channel?.id,
      channel.id,
      session.channelId
    ),
    { allowUserAlias: true }
  );
  const parentChannelId = normalizeDiscordId(
    firstString(
      context.parentChannelId,
      context.parent_channel_id,
      context.threadParentId,
      metadata.parentChannelId,
      metadata.parent_channel_id,
      metadata.parentChannel,
      metadata.channelParentId,
      message.parentChannelId,
      message.parent_channel_id,
      message.parentId,
      message.parent_id,
      channel.parentId,
      channel.parent_id,
      thread.parentId,
      thread.parent_id
    )
  );
  const threadId = normalizeDiscordId(
    firstString(
      context.threadId,
      context.thread_id,
      metadata.threadId,
      message.threadId,
      message.thread_id,
      thread.id
    )
  );

  const groupFromSlug = resolveGroup(goals, { slug });
  if (groupFromSlug) {
    return {
      group: groupFromSlug,
      channelId: groupFromSlug.channelId,
      resolvedBy: "slug",
      threadId,
      isThread: Boolean(threadId)
    };
  }

  const channelCandidates = [
    { value: parentChannelId, source: "parentChannelId" },
    { value: directChannelId, source: "channelId" }
  ];
  for (const candidate of channelCandidates) {
    if (!candidate.value) continue;
    const group = resolveGroup(goals, { channelId: candidate.value });
    if (group) {
      return {
        group,
        channelId: candidate.value,
        resolvedBy: candidate.source,
        threadId,
        isThread: Boolean(threadId || candidate.source === "parentChannelId")
      };
    }
  }

  return {
    group: undefined,
    channelId: directChannelId,
    resolvedBy: undefined,
    threadId,
    isThread: Boolean(threadId)
  };
}

function markdownList(values) {
  return values.map((value) => `- ${value}`).join("\n");
}

function defaultSoul(group) {
  return `# ${group.slug} Soul

This group behaves like ${group.name}: an organization with its own goal,
cadence, and operating style.

## Personality

- Keep discussion aligned with the group goal.
- Prefer concrete next actions over vague commentary.
- Keep the channel's natural tone; do not force every message into a meeting.
- Use specialists only when their perspective clearly improves the outcome.

## Goal Pressure

- One-line goal: ${group.oneLineGoal}
- North Star: ${group.northStar}

## Guardrails

${markdownList(group.guardrailMetrics)}
`;
}

function defaultUser(group) {
  return `# ${group.slug} User Context

This file stores reviewed, stable human/user preferences for this group.

## Current Defaults

- Optimize for the group goal: ${group.oneLineGoal}
- Keep replies proportional to the channel's purpose.
- Ask for clarification when the requested outcome or owner is ambiguous.
- Do not infer private or stale human facts unless they are documented here or
  in a reviewed group memory file.
`;
}

function defaultAgents(group) {
  return `# ${group.slug} Agent Rules

This file defines group-specific agent behavior. Personal agent identity still
comes from \`workspace/agents/<agent>/\`; this file describes the organization's
expectations.

## Context Precedence

\`\`\`text
current user instruction > current thread/project state > current group/company goals > organization rules > agent personal identity/skills > long-term memory/style
\`\`\`

## Goal

- One-line goal: ${group.oneLineGoal}
- North Star: ${group.northStar}

## Operating Metrics

${markdownList(group.operatingMetrics)}

## Guardrail Metrics

${markdownList(group.guardrailMetrics)}

## Routing Rules

- The host agent owns orchestration, routing, summaries, and review loops.
- Domain agents own substance only when mentioned, assigned, or clearly
  responsible for the topic.
- Prefer one accountable owner over broad fan-out.
- If a human directly mentions an expert, the expert should answer first.
- If the task is long, evidence-heavy, or noisy, move it to a thread.
`;
}

function defaultMemory(group) {
  return `# ${group.slug} Memory

Reviewed long-term memory for ${group.name}.

Do not paste raw chat logs here. Distill only durable facts, decisions, review
outcomes, and stable preferences.

## Current State

- Group goal: ${group.oneLineGoal}
- Measurement status: not yet instrumented through group sessions.
`;
}

function defaultHeartbeat(group, review) {
  return `# ${group.slug} Heartbeat

Review this group every ${review.cadenceDays} days.

## Review Inputs

- Group goal source: \`workspace/groups/company-goals.json\`
- Review template: \`${review.template}\`
- Review output path: \`${review.statsPath}\`
- Group sessions: \`workspace/groups/${group.slug}/sessions/\`

## Review Questions

- Did the group produce evidence for the North Star?
- Did operating metrics improve or degrade?
- Did any guardrail metric fire?
- What should the host agent route, summarize, or stop doing next period?
`;
}

function defaultFileContents(group, review) {
  return {
    "SOUL.md": defaultSoul(group),
    "USER.md": defaultUser(group),
    "AGENTS.md": defaultAgents(group),
    "MEMORY.md": defaultMemory(group),
    "HEARTBEAT.md": defaultHeartbeat(group, review)
  };
}

function writeIfMissing(path, content) {
  if (existsSync(path)) return false;
  writeFileSync(path, content);
  return true;
}

export function ensureGroupWorkspace(root, group, review) {
  const dir = getGroupDir(root, group);
  const sessionsDir = resolve(dir, "sessions");
  mkdirSync(sessionsDir, { recursive: true });

  const created = [];
  const contents = defaultFileContents(group, review);
  for (const [name, content] of Object.entries(contents)) {
    const path = resolve(dir, name);
    if (writeIfMissing(path, content)) created.push(path);
  }
  if (writeIfMissing(resolve(sessionsDir, "sessions.json"), "{}\n")) {
    created.push(resolve(sessionsDir, "sessions.json"));
  }
  return created;
}

export function ensureAllGroupWorkspaces(root = repoRoot) {
  const goals = loadGoals(root);
  const created = [];
  for (const group of goals.groups) {
    created.push(...ensureGroupWorkspace(root, group, goals.review));
  }
  return created;
}

function readTextIfExists(path) {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

export function validateGroupWorkspaces(root = repoRoot) {
  const goals = loadGoals(root);
  const errors = [];
  const channelIds = new Set();
  const slugs = new Set();

  for (const group of goals.groups) {
    if (slugs.has(group.slug)) errors.push(`duplicate slug ${group.slug}`);
    slugs.add(group.slug);
    if (channelIds.has(group.channelId)) errors.push(`duplicate channelId ${group.channelId}`);
    channelIds.add(group.channelId);

    const dir = getGroupDir(root, group);
    for (const file of REQUIRED_GROUP_FILES) {
      const path = resolve(dir, file);
      if (!existsSync(path)) errors.push(`${group.slug}: missing ${file}`);
    }
    const sessionsPath = resolve(dir, "sessions/sessions.json");
    if (!existsSync(sessionsPath)) {
      errors.push(`${group.slug}: missing sessions/sessions.json`);
    } else {
      try {
        const parsed = readJson(sessionsPath);
        if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
          errors.push(`${group.slug}: sessions/sessions.json must be an object map`);
        }
      } catch (error) {
        errors.push(`${group.slug}: sessions/sessions.json invalid JSON: ${error.message}`);
      }
    }

    const identity = readTextIfExists(resolve(dir, "IDENTITY.md"));
    for (const value of [
      group.channelId,
      group.oneLineGoal,
      group.northStar,
      ...group.operatingMetrics,
      ...group.guardrailMetrics
    ]) {
      if (!identity.includes(value)) errors.push(`${group.slug}: IDENTITY.md missing "${value}"`);
    }
  }
  return errors;
}

export function buildGroupContext(root, group, options = {}) {
  const dir = getGroupDir(root, group);
  const files = options.files ?? REQUIRED_GROUP_FILES;
  const sections = [];
  const loaded = [];

  for (const file of files) {
    const path = resolve(dir, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8").trim();
    if (!text) continue;
    const hash = createHash("sha256").update(text).digest("hex");
    loaded.push({ file, hash });
    sections.push(`<group_file name="${file}" sha256="${hash}">\n${text}\n</group_file>`);
  }

  const body = sections.join("\n\n");
  return {
    text: `<group_context slug="${group.slug}" channel_id="${group.channelId}">\n${body}\n</group_context>`,
    loaded
  };
}

export function buildSharedGroupContext(root, options = {}) {
  const files = options.sharedFiles ?? SHARED_GROUP_CONTEXT_FILES;
  const sections = [];
  const loaded = [];

  for (const file of files) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8").trim();
    if (!text) continue;
    const hash = createHash("sha256").update(text).digest("hex");
    loaded.push({ file, hash });
    sections.push(`<group_shared_file path="${file}" sha256="${hash}">\n${text}\n</group_shared_file>`);
  }

  return {
    text: sections.join("\n\n"),
    loaded
  };
}

function redactString(value) {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED_SECRET]");
  }
  return redacted;
}

export function sanitizeForGroupSession(value) {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((entry) => sanitizeForGroupSession(entry));
  if (!value || typeof value !== "object") return value;

  const sanitized = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      sanitized[key] = "[REDACTED_SECRET]";
    } else {
      sanitized[key] = sanitizeForGroupSession(nested);
    }
  }
  return sanitized;
}

function parseJsonLines(path) {
  const result = { events: [], invalidLines: 0 };
  if (!existsSync(path)) return result;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      result.events.push(JSON.parse(line));
    } catch {
      result.invalidLines += 1;
    }
  }
  return result;
}

function resolveStoredSessionFile(root, sessionFile) {
  if (!sessionFile || existsSync(sessionFile)) return sessionFile;
  const marker = "/workspace/groups/";
  const markerIndex = sessionFile.indexOf(marker);
  if (markerIndex === -1) return sessionFile;
  return resolve(root, sessionFile.slice(markerIndex + 1));
}

function increment(map, key) {
  const normalized = key || "unknown";
  map[normalized] = (map[normalized] ?? 0) + 1;
}

function auditSessionFile(path) {
  const parsed = parseJsonLines(path);
  const audit = {
    events: parsed.events.length,
    invalidLines: parsed.invalidLines,
    messages: 0,
    directions: {},
    authorTypes: {},
    missingFields: {}
  };

  for (const event of parsed.events) {
    if (event.type !== "message") continue;
    audit.messages += 1;
    increment(audit.directions, event.direction);
    increment(audit.authorTypes, event.authorType);
    for (const field of REQUIRED_MESSAGE_FIELDS) {
      if (event[field] === undefined || event[field] === null || event[field] === "") {
        increment(audit.missingFields, field);
      }
    }
    if (Array.isArray(event.content) && event.content.length === 0) {
      increment(audit.missingFields, "content");
    }
  }
  return audit;
}

function mergeCountMap(target, source) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

export function auditGroupTranscripts(root = repoRoot, options = {}) {
  const goals = options.goals ?? loadGoals(root);
  const report = {
    groups: {},
    totals: {
      groups: 0,
      sessions: 0,
      events: 0,
      messages: 0,
      invalidLines: 0,
      directions: {},
      authorTypes: {},
      missingFields: {}
    }
  };

  for (const group of goals.groups) {
    const sessionsPath = resolve(getGroupDir(root, group), "sessions/sessions.json");
    const groupReport = {
      sessions: 0,
      events: 0,
      messages: 0,
      invalidLines: 0,
      directions: {},
      authorTypes: {},
      missingFields: {},
      sessionFiles: []
    };

    if (!existsSync(sessionsPath)) {
      groupReport.missingSessionsIndex = true;
      report.groups[group.slug] = groupReport;
      report.totals.groups += 1;
      continue;
    }

    const sessions = readJson(sessionsPath);
    for (const [sessionKey, session] of Object.entries(sessions)) {
      const sessionFile = resolveStoredSessionFile(root, session?.sessionFile);
      if (!sessionFile || !existsSync(sessionFile)) {
        groupReport.sessionFiles.push({ sessionKey, sessionFile: session?.sessionFile, missing: true });
        continue;
      }
      const sessionAudit = auditSessionFile(sessionFile);
      groupReport.sessions += 1;
      groupReport.events += sessionAudit.events;
      groupReport.messages += sessionAudit.messages;
      groupReport.invalidLines += sessionAudit.invalidLines;
      mergeCountMap(groupReport.directions, sessionAudit.directions);
      mergeCountMap(groupReport.authorTypes, sessionAudit.authorTypes);
      mergeCountMap(groupReport.missingFields, sessionAudit.missingFields);
      groupReport.sessionFiles.push({ sessionKey, sessionFile, ...sessionAudit });
    }

    report.groups[group.slug] = groupReport;
    report.totals.groups += 1;
    report.totals.sessions += groupReport.sessions;
    report.totals.events += groupReport.events;
    report.totals.messages += groupReport.messages;
    report.totals.invalidLines += groupReport.invalidLines;
    mergeCountMap(report.totals.directions, groupReport.directions);
    mergeCountMap(report.totals.authorTypes, groupReport.authorTypes);
    mergeCountMap(report.totals.missingFields, groupReport.missingFields);
  }

  return report;
}

function formatTranscriptAudit(report) {
  const lines = [
    `Groups: ${report.totals.groups}`,
    `Sessions: ${report.totals.sessions}`,
    `Events: ${report.totals.events}`,
    `Messages: ${report.totals.messages}`,
    `Invalid JSONL lines: ${report.totals.invalidLines}`,
    `Directions: ${JSON.stringify(report.totals.directions)}`,
    `Author types: ${JSON.stringify(report.totals.authorTypes)}`,
    `Missing message fields: ${JSON.stringify(report.totals.missingFields)}`
  ];
  for (const [slug, group] of Object.entries(report.groups)) {
    if (group.messages === 0 && group.sessions === 0 && !group.missingSessionsIndex) continue;
    lines.push(
      `${slug}: sessions=${group.sessions} messages=${group.messages} invalidLines=${group.invalidLines} missing=${JSON.stringify(group.missingFields)}`
    );
  }
  return lines.join("\n");
}

function listFilesRecursive(dir, predicate, results = []) {
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      listFilesRecursive(path, predicate, results);
    } else if (!predicate || predicate(path)) {
      results.push(path);
    }
  }
  return results;
}

export function auditDiscordMemory(root = repoRoot) {
  const base = resolve(root, DISCORD_MEMORY_DIR);
  const report = {
    base,
    files: 0,
    events: 0,
    invalidLines: 0,
    conversationKinds: {},
    directions: {},
    missingFields: {},
    filesByPath: {}
  };
  for (const file of listFilesRecursive(base, (path) => path.endsWith(".jsonl"))) {
    const parsed = parseJsonLines(file);
    const fileReport = { events: 0, invalidLines: parsed.invalidLines, conversationKinds: {}, directions: {}, missingFields: {} };
    for (const event of parsed.events) {
      fileReport.events += 1;
      const kind = event.conversationKind ?? "unknown";
      const direction = event.direction ?? "unknown";
      fileReport.conversationKinds[kind] = (fileReport.conversationKinds[kind] ?? 0) + 1;
      fileReport.directions[direction] = (fileReport.directions[direction] ?? 0) + 1;
      report.conversationKinds[kind] = (report.conversationKinds[kind] ?? 0) + 1;
      report.directions[direction] = (report.directions[direction] ?? 0) + 1;
      for (const field of REQUIRED_MESSAGE_FIELDS) {
        if (event[field] === undefined || event[field] === null || event[field] === "") {
          fileReport.missingFields[field] = (fileReport.missingFields[field] ?? 0) + 1;
          report.missingFields[field] = (report.missingFields[field] ?? 0) + 1;
        }
      }
    }
    report.files += 1;
    report.events += fileReport.events;
    report.invalidLines += fileReport.invalidLines;
    report.filesByPath[file.slice(root.length + 1)] = fileReport;
  }
  return report;
}

function formatDiscordMemoryAudit(report) {
  return [
    `Discord memory files: ${report.files}`,
    `Discord memory events: ${report.events}`,
    `Invalid JSONL lines: ${report.invalidLines}`,
    `Conversation kinds: ${JSON.stringify(report.conversationKinds)}`,
    `Directions: ${JSON.stringify(report.directions)}`,
    `Missing message fields: ${JSON.stringify(report.missingFields)}`
  ].join("\n");
}

function findSessionForTail(root, group, context = {}) {
  const sessionsPath = resolve(getGroupDir(root, group), "sessions/sessions.json");
  if (!existsSync(sessionsPath)) return undefined;
  const sessions = readJson(sessionsPath);
  const threadId = firstString(context.threadId, context.thread_id);
  const channelId = firstString(context.channelId, context.channel_id, group.channelId);
  const preferredKey = threadId
    ? `group:${group.slug}:discord:thread:${threadId}`
    : `group:${group.slug}:discord:channel:${channelId}`;
  return sessions[preferredKey] ?? sessions[`group:${group.slug}:discord:channel:${group.channelId}`];
}

export function readRecentGroupEvents(root, group, context = {}, limit = DEFAULT_TRANSCRIPT_TAIL_EVENTS) {
  const session = findSessionForTail(root, group, context);
  if (!session?.sessionFile) return { events: [], source: undefined };
  const sessionFile = resolveStoredSessionFile(root, session.sessionFile);
  const parsed = parseJsonLines(sessionFile);
  const events = parsed.events
    .filter((event) => event.type !== "session")
    .slice(-Math.max(0, limit))
    .map((event) => sanitizeForGroupSession(event));
  return {
    events,
    source: sessionFile,
    sessionId: session.sessionId,
    invalidLines: parsed.invalidLines
  };
}

export function buildGroupPromptContext(root, context = {}, options = {}) {
  const goals = options.goals ?? loadGoals(root);
  const resolution = resolveGroupFromContext(goals, context);
  if (!resolution.group) {
    const sharedContext = buildSharedGroupContext(root, options);
    const channelId = resolution.channelId ?? firstString(context.channelId, context.channel_id);
    const threadId = resolution.threadId ?? firstString(context.threadId, context.thread_id);
    const unmappedText = [
      `<group_context_unmapped channel_id="${channelId ?? ""}" thread_id="${threadId ?? ""}">`,
      "This Discord channel is not registered in workspace/groups/company-goals.json.",
      "Treat this as a new or unmapped group. If the message needs a response, reply briefly and ask whether to onboard this channel. To onboard, ask the human to confirm: one-line goal, north star, two operating metrics, and two guardrail metrics.",
      "Do not start hosted discussions, participation events, research threads, cron work, or long-running stateful flows until the channel has a canonical group workspace or the human explicitly asks for a one-off action.",
      "</group_context_unmapped>"
    ].join("\n");
    const sharedText = sharedContext.text ? `\n\n${sharedContext.text}` : "";
    return {
      text: `${unmappedText}${sharedText}`,
      audit: {
        loaded: true,
        unmapped: true,
        reason: "no matching group for Discord channel context; loaded shared fallback",
        channelId,
        threadId,
        sharedFiles: sharedContext.loaded
      }
    };
  }

  const groupContext = buildGroupContext(root, resolution.group, options);
  const sharedContext = buildSharedGroupContext(root, options);
  const tailLimit = options.tailEvents ?? DEFAULT_TRANSCRIPT_TAIL_EVENTS;
  const tail = tailLimit > 0 ? readRecentGroupEvents(root, resolution.group, resolution, tailLimit) : undefined;
  const tailText =
    tail?.events?.length > 0
      ? `\n\n<group_transcript_tail source="${tail.source}" events="${tail.events.length}">\n${tail.events
          .map((event) => JSON.stringify(event))
          .join("\n")}\n</group_transcript_tail>`
      : "";
  const sharedText = sharedContext.text ? `\n\n${sharedContext.text}` : "";

  return {
    text: `${groupContext.text}${sharedText}${tailText}`,
    audit: {
      loaded: true,
      groupSlug: resolution.group.slug,
      channelId: resolution.channelId,
      threadId: resolution.threadId,
      resolvedBy: resolution.resolvedBy,
      files: groupContext.loaded,
      sharedFiles: sharedContext.loaded,
      transcriptTail: tail
        ? {
            source: tail.source,
            sessionId: tail.sessionId,
            events: tail.events.length,
            invalidLines: tail.invalidLines ?? 0
          }
        : undefined
    }
  };
}

function hashToUuid(value) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function atomicWriteJson(path, value) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

function sessionFileHasMessage(sessionFile, messageId, direction) {
  if (!messageId || !existsSync(sessionFile)) return false;
  for (const line of readFileSync(sessionFile, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type === "message" && event.messageId === messageId && event.direction === direction) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export function appendGroupSessionEvent(root, group, event) {
  const dir = getGroupDir(root, group);
  const sessionsDir = resolve(dir, "sessions");
  mkdirSync(sessionsDir, { recursive: true });

  const sessionKey =
    event.threadId && typeof event.threadId === "string"
      ? `group:${group.slug}:discord:thread:${event.threadId}`
      : `group:${group.slug}:discord:channel:${group.channelId}`;
  const sessionsPath = resolve(sessionsDir, "sessions.json");
  const sessions = existsSync(sessionsPath) ? readJson(sessionsPath) : {};
  const now = Date.now();
  const existing = sessions[sessionKey];
  const sessionId = existing?.sessionId ?? hashToUuid(sessionKey);
  const sessionFile = resolve(sessionsDir, `${sessionId}.jsonl`);

  if (!existing) {
    appendFileSync(
      sessionFile,
      `${JSON.stringify({
        type: "session",
        version: 1,
        id: sessionId,
        timestamp: new Date(now).toISOString(),
        groupSlug: group.slug,
        channel: "discord",
        channelId: group.channelId,
        channelName: group.slug
      })}\n`
    );
  }

  const normalizedEvent = {
    version: 1,
    timestamp: new Date(now).toISOString(),
    groupSlug: group.slug,
    channel: "discord",
    channelId: group.channelId,
    ...sanitizeForGroupSession(event)
  };
  if (!normalizedEvent.type) throw new Error("event.type is required");
  if (sessionFileHasMessage(sessionFile, normalizedEvent.messageId, normalizedEvent.direction)) {
    return { sessionKey, sessionId, sessionFile, event: normalizedEvent, duplicate: true };
  }
  appendFileSync(sessionFile, `${JSON.stringify(normalizedEvent)}\n`);

  sessions[sessionKey] = {
    ...(existing ?? {}),
    sessionId,
    updatedAt: now,
    sessionStartedAt: existing?.sessionStartedAt ?? now,
    lastInteractionAt: now,
    displayName: existing?.displayName ?? `discord:${group.slug}`,
    chatType: event.threadId ? "thread" : "channel",
    channel: "discord",
    groupSlug: group.slug,
    groupId: group.channelId,
    groupChannel: `#${group.slug}`,
    sessionFile
  };
  atomicWriteJson(sessionsPath, sessions);
  return { sessionKey, sessionId, sessionFile, event: normalizedEvent };
}

function normalizeContent(content) {
  if (Array.isArray(content)) return sanitizeForGroupSession(content);
  if (typeof content === "string") return [{ type: "text", text: redactString(content) }];
  if (content === undefined || content === null) return [];
  return [{ type: "text", text: redactString(String(content)) }];
}

function normalizeIdList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => firstString(entry?.id, entry?.user?.id, entry))
      .filter(Boolean);
  }
  if (typeof value.values === "function") {
    return Array.from(value.values())
      .map((entry) => firstString(entry?.id, entry?.user?.id, entry))
      .filter(Boolean);
  }
  return [];
}

function normalizeAttachments(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : typeof value.values === "function" ? Array.from(value.values()) : [];
  return items.map((attachment) =>
    sanitizeForGroupSession({
      id: firstString(attachment.id),
      name: firstString(attachment.name, attachment.filename),
      contentType: firstString(attachment.contentType, attachment.content_type),
      size: typeof attachment.size === "number" ? attachment.size : undefined,
      url: firstString(attachment.url)
    })
  );
}

function safePathSegment(value, fallback = "unknown") {
  const text = firstString(value)?.trim();
  if (!text) return fallback;
  return text.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function firstBoolean(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes"].includes(normalized)) return true;
      if (["false", "0", "no"].includes(normalized)) return false;
    }
  }
  return undefined;
}

function monthFromTimestamp(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toISOString().slice(0, 7);
}

function markdownEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r/g, "");
}

function markdownQuote(value) {
  const text = String(value ?? "");
  if (!text) return "> ";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function eventContentText(event) {
  const content = Array.isArray(event.content) ? event.content : normalizeContent(event.content);
  const parts = [];
  for (const item of content) {
    if (!item) continue;
    if (typeof item === "string") {
      parts.push(item);
    } else if (typeof item.text === "string") {
      parts.push(item.text);
    } else if (typeof item.value === "string") {
      parts.push(item.value);
    } else {
      parts.push(JSON.stringify(item));
    }
  }
  return parts.join("\n\n");
}

function ledgerScopeForEvent(root, event, group) {
  const guildId = safePathSegment(event.guildId, "dm");
  const channelId = safePathSegment(event.channelId, "unknown-channel");
  const threadId = safePathSegment(event.threadId, "");
  const groupSlug = safePathSegment(group?.slug, "");
  if (event.guildId) {
    if (event.threadId) {
      return resolve(root, DISCORD_LEDGER_DIR, "guilds", guildId, "channels", channelId, "threads", threadId);
    }
    return resolve(root, DISCORD_LEDGER_DIR, "guilds", guildId, "channels", channelId);
  }
  if (group?.slug) {
    if (event.threadId) {
      return resolve(root, DISCORD_LEDGER_DIR, "groups", groupSlug, "channels", channelId, "threads", threadId);
    }
    return resolve(root, DISCORD_LEDGER_DIR, "groups", groupSlug, "channels", channelId);
  }
  if (event.threadId) {
    return resolve(root, DISCORD_LEDGER_DIR, "dms", channelId, "threads", threadId);
  }
  return resolve(root, DISCORD_LEDGER_DIR, "dms", channelId);
}

function channelTypeValue(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function isDiscordThreadType(value) {
  const type = channelTypeValue(value);
  return DISCORD_THREAD_CHANNEL_TYPES.has(type);
}

function isDiscordForumType(value) {
  const type = channelTypeValue(value);
  return DISCORD_FORUM_CHANNEL_TYPES.has(type);
}

function isDiscordDmType(value) {
  const type = channelTypeValue(value);
  return DISCORD_DM_CHANNEL_TYPES.has(type);
}

function classifyDiscordConversation(event, group) {
  const channelType = channelTypeValue(event.channelType);
  const parentChannelType = channelTypeValue(event.parentChannelType);
  const hasGuild = Boolean(event.guildId);
  const hasThread = Boolean(event.threadId) || isDiscordThreadType(channelType);
  const isForumThread =
    firstBoolean(event.isForumThread) ??
    Boolean(hasThread && (isDiscordForumType(parentChannelType) || event.parentKind === "forum"));
  const isDirectMessage =
    firstBoolean(event.isDirectMessage, event.isDm) ??
    Boolean(!hasGuild && !group?.slug && (isDiscordDmType(channelType) || !event.threadId));
  const isGroupDm =
    firstBoolean(event.isGroupDm, event.isGroupDM) ??
    (channelType === "GROUP_DM" || channelType === 3 || channelType === "3");

  if (isForumThread) return "forum_thread";
  if (hasThread) return "thread";
  if (isGroupDm) return "group_dm";
  if (isDirectMessage) return "dm";
  if (hasGuild || group?.slug) return "guild_channel";
  return "unknown";
}

function memoryScopeForEvent(root, event, group) {
  const conversationKind = classifyDiscordConversation(event, group);
  const guildId = safePathSegment(event.guildId, "unknown-guild");
  const channelId = safePathSegment(event.channelId, "unknown-channel");
  const threadId = safePathSegment(event.threadId, "");
  const groupSlug = safePathSegment(group?.slug, "");
  if (conversationKind === "dm" || conversationKind === "group_dm") {
    const kindDir = conversationKind === "group_dm" ? "group-dms" : "dms";
    return resolve(root, DISCORD_MEMORY_DIR, kindDir, channelId);
  }
  if (!event.guildId && group?.slug) {
    if (threadId) {
      return resolve(root, DISCORD_MEMORY_DIR, "groups", groupSlug, "channels", channelId, "threads", threadId);
    }
    return resolve(root, DISCORD_MEMORY_DIR, "groups", groupSlug, "channels", channelId);
  }
  if (threadId) {
    return resolve(root, DISCORD_MEMORY_DIR, "guilds", guildId, "channels", channelId, "threads", threadId);
  }
  return resolve(root, DISCORD_MEMORY_DIR, "guilds", guildId, "channels", channelId);
}

function memoryEventMarker(event) {
  const type = event.type || "message";
  const id = event.messageId || createHash("sha256").update(JSON.stringify(event)).digest("hex").slice(0, 16);
  const direction = event.direction || "unknown";
  return `${type}:${id}:${direction}`;
}

function memoryFileHasEvent(memoryFile, marker) {
  if (!marker || !existsSync(memoryFile)) return false;
  for (const line of readFileSync(memoryFile, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.memoryEventId === marker) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function memoryDirEventFile(eventsDir, marker) {
  if (!marker || !existsSync(eventsDir)) return undefined;
  for (const entry of readdirSync(eventsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const file = resolve(eventsDir, entry.name);
    if (memoryFileHasEvent(file, marker)) return file;
  }
  return undefined;
}

function ensureDiscordMemoryReadme(root) {
  const readme = resolve(root, DISCORD_MEMORY_DIR, "README.md");
  if (existsSync(readme)) return;
  mkdirSync(dirname(readme), { recursive: true });
  writeFileSync(
    readme,
    `# Discord Memory

Append-only Discord transcript memory written by the Clawclave group-context
plugin.

- Raw message memory is stored as monthly JSONL under this directory.
- Mapped group events without guild metadata are stored under
  \`memory/discord/groups/<slug>/\`.
- Human-readable mirrors are stored under \`memory/discord/ledger/\`.
- Group prompt tails still use \`workspace/groups/<slug>/sessions/*.jsonl\`.
- Attachment records store metadata and URLs only; binaries are not downloaded.
- Current plugin hooks cover received and sent messages. Edit/delete/reaction
  events require dedicated Discord event hooks before they are complete.
`
  );
}

function writeDiscordMemoryManifest(dir, event, { group, conversationKind, memoryFile }) {
  const manifestPath = resolve(dir, "manifest.json");
  const previous = existsSync(manifestPath) ? readJson(manifestPath) : {};
  const manifest = {
    version: 1,
    scope: {
      provider: "discord",
      conversationKind,
      groupSlug: group?.slug,
      guildId: event.guildId,
      channelId: event.channelId,
      parentChannelId: event.parentChannelId,
      threadId: event.threadId,
      channelType: event.channelType,
      parentChannelType: event.parentChannelType
    },
    createdAt: previous.createdAt ?? event.timestamp ?? new Date().toISOString(),
    updatedAt: event.timestamp ?? new Date().toISOString(),
    lastEventId: event.memoryEventId,
    lastMessageId: event.messageId,
    lastDirection: event.direction,
    files: Array.from(new Set([...(Array.isArray(previous.files) ? previous.files : []), memoryFile]))
  };
  atomicWriteJson(manifestPath, sanitizeForGroupSession(manifest));
  return manifestPath;
}

export function appendDiscordMemoryEvent(root, event, { group } = {}) {
  const timestamp = firstTimestamp(event.timestamp) ?? new Date().toISOString();
  const conversationKind = classifyDiscordConversation(event, group);
  const normalizedEvent = sanitizeForGroupSession({
    ...event,
    timestamp,
    conversationKind,
    memoryEventId: memoryEventMarker(event)
  });
  ensureDiscordMemoryReadme(root);
  const dir = memoryScopeForEvent(root, normalizedEvent, group);
  const eventsDir = resolve(dir, "events");
  mkdirSync(eventsDir, { recursive: true });
  const month = monthFromTimestamp(timestamp);
  const memoryFile = resolve(eventsDir, `${month}.jsonl`);
  const relativeMemoryFile = memoryFile.slice(root.length + 1);
  const existingMemoryFile = memoryFileHasEvent(memoryFile, normalizedEvent.memoryEventId)
    ? memoryFile
    : memoryDirEventFile(eventsDir, normalizedEvent.memoryEventId);
  if (existingMemoryFile) {
    return {
      memoryFile: existingMemoryFile,
      memoryManifest: resolve(dir, "manifest.json"),
      memoryDuplicate: true,
      memoryAppended: false,
      conversationKind
    };
  }
  appendFileSync(memoryFile, `${JSON.stringify(normalizedEvent)}\n`);
  const memoryManifest = writeDiscordMemoryManifest(dir, normalizedEvent, {
    group,
    conversationKind,
    memoryFile: relativeMemoryFile
  });
  return {
    memoryFile,
    memoryManifest,
    memoryDuplicate: false,
    memoryAppended: true,
    conversationKind
  };
}

function ledgerFileHeader(event, month, { group } = {}) {
  const title = event.guildId
    ? event.threadId
      ? `Discord Thread Transcript ${event.threadId}`
      : `Discord Channel Transcript ${event.channelId ?? "unknown"}`
    : group?.slug
      ? event.threadId
        ? `Discord Group Thread Transcript ${group.slug}/${event.threadId}`
        : `Discord Group Channel Transcript ${group.slug}/${event.channelId ?? "unknown"}`
    : `Discord DM Transcript ${event.channelId ?? "unknown"}`;
  return `# ${title}

- Month: ${month}
- Group: ${group?.slug ?? "n/a"}
- Guild ID: ${event.guildId ?? "n/a"}
- Channel ID: ${event.channelId ?? "n/a"}
- Thread ID: ${event.threadId ?? "n/a"}

`;
}

function ledgerEventMarker(event) {
  const type = event.type || "message";
  const id = event.messageId || createHash("sha256").update(JSON.stringify(event)).digest("hex").slice(0, 16);
  const direction = event.direction || "unknown";
  return `<!-- discord-ledger:event ${type}:${id}:${direction} -->`;
}

function ledgerDirEventFile(dir, marker) {
  if (!marker || !existsSync(dir)) return undefined;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const file = resolve(dir, entry.name);
    if (readFileSync(file, "utf8").includes(marker)) return file;
  }
  return undefined;
}

function renderMarkdownLedgerEvent(event, { group } = {}) {
  const timestamp = event.timestamp ?? new Date().toISOString();
  const marker = ledgerEventMarker(event);
  const contentText = eventContentText(event);
  const attachments = Array.isArray(event.attachments) ? event.attachments : [];
  const mentions = Array.isArray(event.mentions) ? event.mentions.join(", ") : "";
  const roleMentions = Array.isArray(event.roleMentions) ? event.roleMentions.join(", ") : "";
  const lines = [
    `## ${markdownEscape(timestamp)} · ${markdownEscape(event.direction ?? "unknown")} · message ${markdownEscape(event.messageId ?? "unknown")}`,
    marker,
    "",
    `- Group: ${markdownEscape(group?.slug ?? "unmapped")}`,
    `- Guild: ${markdownEscape(event.guildId ?? "n/a")}`,
    `- Channel: ${markdownEscape(event.channelId ?? "n/a")}`,
    `- Thread: ${markdownEscape(event.threadId ?? "n/a")}`,
    `- Author: ${markdownEscape(event.authorLabel ?? event.authorId ?? "unknown")}`,
    `- Author ID: ${markdownEscape(event.authorId ?? "n/a")}`,
    `- Author type: ${markdownEscape(event.authorType ?? "unknown")}`,
    `- Agent: ${markdownEscape(event.agentSlug ?? "n/a")}`,
    `- Reply to: ${markdownEscape(event.replyToId ?? "n/a")}`,
    `- Mentions: ${markdownEscape(mentions || "n/a")}`,
    `- Role mentions: ${markdownEscape(roleMentions || "n/a")}`,
    "",
    "### Content",
    "",
    markdownQuote(contentText),
    ""
  ];
  if (attachments.length > 0) {
    lines.push("### Attachments", "");
    for (const attachment of attachments) {
      lines.push(
        `- ${markdownEscape(attachment.name ?? attachment.id ?? "attachment")} (${markdownEscape(
          attachment.contentType ?? "unknown"
        )}, ${markdownEscape(attachment.size ?? "unknown")} bytes) ${markdownEscape(attachment.url ?? "")}`.trim()
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function appendDiscordMarkdownLedgerEvent(root, event, { group } = {}) {
  const timestamp = firstTimestamp(event.timestamp) ?? new Date().toISOString();
  const normalizedEvent = { ...event, timestamp };
  const month = monthFromTimestamp(timestamp);
  const dir = ledgerScopeForEvent(root, normalizedEvent, group);
  mkdirSync(dir, { recursive: true });
  const ledgerFile = resolve(dir, `${month}.md`);
  const marker = ledgerEventMarker(normalizedEvent);
  const existingLedgerFile = ledgerDirEventFile(dir, marker);
  if (existingLedgerFile) {
    return { ledgerFile: existingLedgerFile, ledgerDuplicate: true, ledgerAppended: false };
  }
  if (!existsSync(ledgerFile)) {
    writeFileSync(ledgerFile, ledgerFileHeader(normalizedEvent, month, { group }));
  }
  const current = readFileSync(ledgerFile, "utf8");
  if (current.includes(marker)) {
    return { ledgerFile, ledgerDuplicate: true, ledgerAppended: false };
  }
  appendFileSync(ledgerFile, renderMarkdownLedgerEvent(normalizedEvent, { group }));
  return { ledgerFile, ledgerDuplicate: false, ledgerAppended: true };
}

export function normalizeDiscordMessageEvent(input = {}) {
  const message = input.message ?? input.discordMessage ?? input;
  const author = input.author ?? message.author ?? message.member?.user ?? {};
  const channel = input.channel ?? message.channel ?? {};
  const thread = input.thread ?? message.thread ?? {};
  const metadata = input.metadata ?? message.metadata ?? {};
  const authorType =
    input.authorType ??
    (input.agentSlug ? "agent" : author.bot || message.webhookId || message.webhook_id ? "bot" : "human");

  return sanitizeForGroupSession({
    type: "message",
    guildId: firstString(
      input.guildId,
      input.guild_id,
      message.guildId,
      message.guild_id,
      message.guild?.id
    ),
    channelId: normalizeDiscordId(
      firstString(input.channelId, input.channel_id, message.channelId, message.channel_id),
      { allowUserAlias: true }
    ),
    parentChannelId: normalizeDiscordId(
      firstString(
        input.parentChannelId,
        input.parent_channel_id,
        input.threadParentId,
        input.thread_parent_id,
        metadata.parentChannelId,
        metadata.parent_channel_id,
        message.parentChannelId,
        message.parent_channel_id,
        channel.parentId,
        channel.parent_id,
        thread.parentId,
        thread.parent_id
      )
    ),
    threadId: normalizeDiscordId(firstString(input.threadId, input.thread_id, message.threadId, message.thread_id)),
    channelType: channelTypeValue(
      input.channelType ??
        input.channel_type ??
        metadata.channelType ??
        metadata.channel_type ??
        message.channelType ??
        message.channel_type ??
        channel.type
    ),
    parentChannelType: channelTypeValue(
      input.parentChannelType ??
        input.parent_channel_type ??
        metadata.parentChannelType ??
        metadata.parent_channel_type ??
        message.parentChannelType ??
        message.parent_channel_type
    ),
    isDirectMessage: firstBoolean(input.isDirectMessage, input.isDM, input.isDm, metadata.isDirectMessage),
    isGuildMessage: firstBoolean(input.isGuildMessage, metadata.isGuildMessage),
    isGroupDm: firstBoolean(input.isGroupDm, input.isGroupDM, metadata.isGroupDm),
    isForumThread: firstBoolean(input.isForumThread, metadata.isForumThread),
    messageId: firstString(input.messageId, input.message_id, message.id),
    timestamp: firstTimestamp(
      input.timestamp,
      input.createdAt,
      input.created_at,
      message.timestamp,
      message.createdAt,
      message.created_at,
      message.createdTimestamp
    ),
    authorId: firstString(input.authorId, input.author_id, author.id),
    authorType,
    direction: firstString(input.direction),
    authorLabel: firstString(
      input.authorLabel,
      input.author_label,
      message.member?.displayName,
      author.globalName,
      author.username,
      author.tag
    ),
    agentSlug: input.agentSlug,
    content: normalizeContent(input.content ?? message.content),
    mentions: normalizeIdList(input.mentions ?? message.mentions?.users ?? message.mentions),
    roleMentions: normalizeIdList(input.roleMentions ?? message.mentions?.roles ?? message.roleMentions),
    replyToId: firstString(
      input.replyToId,
      input.reply_to_id,
      message.reference?.messageId,
      message.reference?.message_id
    ),
    attachments: normalizeAttachments(input.attachments ?? message.attachments)
  });
}

export function appendDiscordMessageEvent(root, goals, input = {}) {
  const resolution = resolveGroupFromContext(goals, input);
  const event = normalizeDiscordMessageEvent({
    ...input,
    channelId: resolution.channelId ?? input.channelId,
    threadId: resolution.threadId ?? input.threadId
  });
  const memory = appendDiscordMemoryEvent(root, event, { group: resolution.group });
  const ledger = appendDiscordMarkdownLedgerEvent(root, event, { group: resolution.group });
  if (!resolution.group) {
    return {
      appended: memory.memoryAppended || ledger.ledgerAppended,
      reason:
        memory.memoryAppended || ledger.ledgerAppended
          ? "recorded Discord memory without group transcript"
          : "duplicate Discord memory event without group transcript",
      channelId: resolution.channelId,
      threadId: resolution.threadId,
      ...memory,
      ...ledger
    };
  }
  const result = appendGroupSessionEvent(root, resolution.group, event);
  if (result.duplicate && !memory.memoryAppended && !ledger.ledgerAppended) {
    return {
      appended: false,
      reason: "duplicate message event",
      groupSlug: resolution.group.slug,
      ...result,
      ...memory,
      ...ledger
    };
  }
  return {
    appended: true,
    reason: result.duplicate ? "recorded Discord memory for duplicate group transcript" : undefined,
    groupSlug: resolution.group.slug,
    ...result,
    ...memory,
    ...ledger
  };
}

function parseArgs(argv) {
  const parsed = { flags: new Set(), values: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed.flags.add(key);
      continue;
    }
    parsed.values[key] = next;
    index += 1;
  }
  return parsed;
}

function usage() {
  return `Usage:
  clawclave group-workspace --init
  clawclave group-workspace --check
  clawclave group-workspace --context --slug <group-slug>
  clawclave group-workspace --context --channel-id <discord-channel-id>
  clawclave group-workspace --prompt-context <context.json>
  clawclave group-workspace --audit-transcripts [--json]
  clawclave group-workspace --audit-discord-memory [--json]
  clawclave group-workspace --append-event <event.json> --slug <group-slug>
  clawclave group-workspace --append-discord-message <message.json>
`;
}

export function runCli(argv = process.argv.slice(2), root = repoRoot) {
  const args = parseArgs(argv);
  if (args.flags.has("help") || argv.length === 0) {
    console.log(usage());
    return 0;
  }

  if (args.flags.has("init")) {
    const created = ensureAllGroupWorkspaces(root);
    console.log(`Initialized group workspaces; created ${created.length} files`);
    return 0;
  }

  if (args.flags.has("check")) {
    const errors = validateGroupWorkspaces(root);
    if (errors.length > 0) {
      console.error(errors.join("\n"));
      return 1;
    }
    console.log("Group workspaces valid");
    return 0;
  }

  const goals = loadGoals(root);

  if (args.values["prompt-context"]) {
    const context = readJson(resolve(process.cwd(), args.values["prompt-context"]));
    const result = buildGroupPromptContext(root, context);
    console.log(JSON.stringify(result, null, 2));
    return result.audit.loaded ? 0 : 2;
  }

  if (args.flags.has("audit-transcripts")) {
    const report = auditGroupTranscripts(root, { goals });
    if (args.flags.has("json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatTranscriptAudit(report));
    }
    return report.totals.invalidLines === 0 ? 0 : 2;
  }

  if (args.flags.has("audit-discord-memory")) {
    const report = auditDiscordMemory(root);
    if (args.flags.has("json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatDiscordMemoryAudit(report));
    }
    return report.invalidLines === 0 ? 0 : 2;
  }

  if (args.values["append-discord-message"]) {
    const message = readJson(resolve(process.cwd(), args.values["append-discord-message"]));
    const result = appendDiscordMessageEvent(root, goals, message);
    console.log(JSON.stringify(result, null, 2));
    return result.appended ? 0 : 2;
  }

  const group = resolveGroup(goals, {
    slug: args.values.slug,
    channelId: args.values["channel-id"]
  });

  if (args.flags.has("context")) {
    if (!group) {
      console.error("Group not found. Provide --slug or --channel-id.");
      return 1;
    }
    console.log(buildGroupContext(root, group).text);
    return 0;
  }

  if (args.values["append-event"]) {
    if (!group) {
      console.error("Group not found. Provide --slug or --channel-id.");
      return 1;
    }
    const event = readJson(resolve(process.cwd(), args.values["append-event"]));
    const result = appendGroupSessionEvent(root, group, event);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  console.error(usage());
  return 1;
}

/* c8 ignore next 3 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli();
}

export function makeTempRoot() {
  return mkdtempSync(resolve(tmpdir(), "clawclave-group-workspace-"));
}

export function removeTempRoot(path) {
  rmSync(path, { recursive: true, force: true });
}
