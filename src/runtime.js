import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const DEFAULT_CONFIG = {
  goalsFile: "workspace/groups/company-goals.json",
  memoryDir: "memory/clawclave",
  onboardingDir: "workspace/groups/onboarding/active",
  hostAccountId: "tianclaw",
  promptContext: true,
  transcriptWriter: true,
  onboarding: true,
  tailEvents: 12
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "bigint") return String(value);
  }
  return undefined;
}

function safeSlug(value, fallback = "unknown") {
  const text = firstString(value) ?? fallback;
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function resolvePath(root, value) {
  const path = firstString(value);
  if (!path) return undefined;
  return isAbsolute(path) ? path : resolve(root, path);
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeDiscordId(value, { allowAlias = true } = {}) {
  const text = firstString(value);
  if (!text) return undefined;
  const channelMatch = text.match(/^channel[:-](\d+)$/);
  if (allowAlias && channelMatch) return channelMatch[1];
  const userMatch = text.match(/^user[:-](\d+)$/);
  if (allowAlias && userMatch) return userMatch[1];
  return text;
}

function monthFromTimestamp(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(date.getTime())) return monthFromTimestamp();
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function readLastJsonlEvents(path, limit) {
  if (!limit || !existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function clampInteger(value, fallback, min, max) {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function normalizePluginConfig(value = {}) {
  const config = isObject(value) ? value : {};
  return {
    rootDir: firstString(config.rootDir),
    goalsFile: firstString(config.goalsFile) ?? DEFAULT_CONFIG.goalsFile,
    memoryDir: firstString(config.memoryDir) ?? DEFAULT_CONFIG.memoryDir,
    onboardingDir: firstString(config.onboardingDir) ?? DEFAULT_CONFIG.onboardingDir,
    hostAccountId: firstString(config.hostAccountId) ?? DEFAULT_CONFIG.hostAccountId,
    promptContext: config.promptContext !== false,
    transcriptWriter: config.transcriptWriter !== false,
    onboarding: config.onboarding !== false,
    tailEvents: clampInteger(config.tailEvents, DEFAULT_CONFIG.tailEvents, 0, 50)
  };
}

export function resolvePluginConfig(event = {}, api = {}) {
  const configured =
    event?.context?.pluginConfig ??
    api.pluginConfig ??
    api.config?.plugins?.entries?.clawclave?.config;
  return normalizePluginConfig(configured);
}

export function resolveRootDir(api = {}, config = normalizePluginConfig()) {
  if (config.rootDir) return resolve(config.rootDir.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
  if (typeof api.resolvePath === "function") return api.resolvePath("../..");
  return process.cwd();
}

export function loadGoals(root, config = normalizePluginConfig()) {
  const path = resolvePath(root, config.goalsFile);
  const goals = readJson(path, { version: 1, groups: [] });
  return {
    path,
    version: goals.version ?? 1,
    groups: Array.isArray(goals.groups) ? goals.groups : []
  };
}

export function isDiscordHookContext(ctx = {}) {
  return (
    ctx.messageProvider === "discord" ||
    ctx.channelId === "discord" ||
    ctx.provider === "discord" ||
    ctx.originatingChannel === "discord"
  );
}

export function resolveDiscordIds(event = {}, ctx = {}) {
  const metadata = isObject(event.metadata) ? event.metadata : {};
  const channelId = normalizeDiscordId(
    firstString(
      event.channelId,
      event.channel_id,
      event.conversationId,
      event.conversation_id,
      metadata.channelId,
      metadata.channel_id,
      metadata.originatingTo,
      metadata.to,
      metadata.groupId,
      ctx.conversationId,
      ctx.conversation_id,
      ctx.messageProvider === "discord" ? ctx.channelId : undefined
    )
  );
  const threadId = normalizeDiscordId(
    firstString(event.threadId, event.thread_id, metadata.threadId, metadata.thread_id, ctx.threadId, ctx.thread_id)
  );
  return {
    guildId: firstString(event.guildId, event.guild_id, metadata.guildId, metadata.guild_id),
    channelId,
    threadId,
    messageId: firstString(event.messageId, event.message_id, ctx.messageId, ctx.message_id, event.runId, event.run_id),
    senderId: firstString(event.senderId, event.sender_id, ctx.senderId, ctx.sender_id)
  };
}

function readDiscordRawMessageData(event = {}) {
  try {
    const raw = event?.message?.rawData;
    if (raw && typeof raw === "object") return raw;
  } catch {
    return {};
  }
  return isObject(event) ? event : {};
}

function buildRawIngressInput({ event = {}, accountId }) {
  const raw = readDiscordRawMessageData(event);
  const content = typeof raw.content === "string" ? raw.content : firstString(event.content);
  return {
    version: 1,
    timestamp: firstString(raw.timestamp, event.timestamp) ?? new Date().toISOString(),
    direction: "inbound",
    provider: "discord",
    source: "discord-raw-ingress",
    accountId,
    guildId: firstString(raw.guild_id, event.guild_id, event.guildId),
    channelId: firstString(raw.channel_id, event.channel_id, event.channelId),
    messageId: firstString(raw.id, event.id, event.messageId),
    authorId: firstString(raw.author?.id, event.author?.id),
    authorLabel: firstString(raw.author?.global_name, raw.author?.username, event.author?.globalName, event.author?.username),
    authorType: raw.author?.bot ? "bot" : "human",
    content: content ?? ""
  };
}

export function resolveGroup(goals, ids = {}) {
  const channelId = ids.channelId;
  if (!channelId) return null;
  return goals.groups.find((group) => firstString(group.channelId) === channelId) ?? null;
}

function transcriptScope(group, ids = {}) {
  if (group?.slug) return `groups/${safeSlug(group.slug)}/channels/${ids.channelId ?? "unknown"}`;
  if (ids.guildId) return `guilds/${ids.guildId}/channels/${ids.channelId ?? "unknown"}`;
  return `channels/${ids.channelId ?? "unknown"}`;
}

function transcriptFile(root, config, group, ids, timestamp) {
  const memoryRoot = resolvePath(root, config.memoryDir);
  const scope = transcriptScope(group, ids);
  const threadPart = ids.threadId ? `/threads/${ids.threadId}` : "";
  return resolve(memoryRoot, "transcripts", scope + threadPart, `${monthFromTimestamp(timestamp)}.jsonl`);
}

export function buildMessageInput({ event = {}, ctx = {}, direction = "inbound" }) {
  const ids = resolveDiscordIds(event, ctx);
  const metadata = isObject(event.metadata) ? event.metadata : {};
  return {
    version: 1,
    timestamp: firstString(event.timestamp, event.createdAt, metadata.timestamp) ?? new Date().toISOString(),
    direction,
    provider: "discord",
    guildId: ids.guildId,
    channelId: ids.channelId,
    threadId: ids.threadId,
    messageId: ids.messageId,
    authorId: firstString(event.authorId, event.author_id, ids.senderId, metadata.authorId),
    authorLabel: firstString(event.authorLabel, event.author_label, event.senderName, metadata.authorLabel),
    authorType: event.authorType ?? (direction === "outbound" ? "agent" : undefined),
    agentId: direction === "outbound" ? firstString(ctx.agentId, ctx.agent_id) : firstString(event.agentId, event.agent_id),
    content: event.content ?? event.prompt ?? event.bodyForAgent ?? event.body ?? ""
  };
}

export function ensureOnboardingState({ root, config, ids, event = {}, group }) {
  if (!config.onboarding || group || !ids.channelId) return { created: false, reason: "not needed" };
  const dir = resolvePath(root, config.onboardingDir);
  const path = resolve(dir, `${ids.channelId}.json`);
  if (existsSync(path)) return { created: false, path, reason: "already exists" };
  const state = {
    version: 1,
    status: "pending_goal",
    provider: "discord",
    guildId: ids.guildId,
    channelId: ids.channelId,
    threadId: ids.threadId,
    firstSeenAt: new Date().toISOString(),
    firstMessageId: ids.messageId,
    firstMessagePreview: firstString(event.content, event.prompt, event.body)?.slice(0, 240),
    requiredFields: ["slug", "name", "oneLineGoal", "northStar", "operatingMetrics", "guardrailMetrics"]
  };
  writeJson(path, state);
  return { created: true, path, state };
}

function buildOnboardingVisiblePrompt(input) {
  return [
    "这个群还没有初始化目标。我先建一个 onboarding 记录。",
    "",
    "请确认这几个字段：",
    "1. slug（小写短横线，例如 westworld）",
    "2. 群名称",
    "3. 一句话目标",
    "4. North Star",
    "5. 两个运营指标",
    "6. 两个护栏指标"
  ].join("\n");
}

export function recordDiscordRawIngress({ root, event = {}, accountId, config = {} }) {
  const normalizedConfig = normalizePluginConfig(config);
  if (!normalizedConfig.onboarding) return { handled: false, reason: "onboarding disabled" };
  const input = buildRawIngressInput({ event, accountId });
  if (!input.guildId || !input.channelId || !input.messageId) {
    return { handled: false, reason: "not a guild channel message", input };
  }

  const goals = loadGoals(root, normalizedConfig);
  const group = resolveGroup(goals, input);
  if (group) return { handled: true, mapped: true, groupSlug: group.slug, input };

  const onboardingDir = resolvePath(root, normalizedConfig.onboardingDir);
  const statePath = resolve(onboardingDir, `${input.channelId}.json`);
  const previous = readJson(statePath, null);
  const now = new Date().toISOString();
  const state = previous ?? {
    version: 1,
    status: "pending_goal",
    provider: "discord",
    guildId: input.guildId,
    channelId: input.channelId,
    firstSeenAt: now,
    firstMessageId: input.messageId,
    firstMessagePreview: String(input.content ?? "").slice(0, 240),
    requiredFields: ["slug", "name", "oneLineGoal", "northStar", "operatingMetrics", "guardrailMetrics"]
  };

  state.updatedAt = now;
  state.lastSeenAt = now;
  state.lastMessageId = input.messageId;
  state.lastSeenByAccountId = accountId;

  const hostAccountId = normalizedConfig.hostAccountId;
  const shouldPrompt = accountId === hostAccountId && !state.promptedAt && input.authorType !== "bot";
  if (shouldPrompt) {
    state.promptedAt = now;
    state.promptedByAccountId = accountId;
    state.promptedForMessageId = input.messageId;
  }
  writeJson(statePath, state);

  return {
    handled: true,
    mapped: false,
    created: !previous,
    path: statePath,
    state,
    input,
    visiblePrompt: shouldPrompt ? buildOnboardingVisiblePrompt(input) : undefined
  };
}

export function appendHookTranscriptEvent({ root, event = {}, ctx = {}, config = {}, direction = "inbound" }) {
  const normalizedConfig = normalizePluginConfig(config);
  if (!normalizedConfig.transcriptWriter) return { appended: false, reason: "transcript writer disabled" };
  if (!isDiscordHookContext(ctx)) return { appended: false, reason: "not a Discord hook context" };

  const goals = loadGoals(root, normalizedConfig);
  const input = buildMessageInput({ event, ctx, direction });
  const group = resolveGroup(goals, input);
  ensureOnboardingState({ root, config: normalizedConfig, ids: input, event, group });

  const file = transcriptFile(root, normalizedConfig, group, input, input.timestamp);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ ...input, groupSlug: group?.slug })}\n`);
  return { appended: true, file, groupSlug: group?.slug, channelId: input.channelId };
}

function formatList(values) {
  return Array.isArray(values) && values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "- Not set";
}

function buildMappedContext({ group, ids, tailEvents }) {
  return [
    `<clawclave_group_context slug="${group.slug ?? ""}" channel_id="${ids.channelId ?? ""}">`,
    `Name: ${group.name ?? group.slug ?? "Unnamed group"}`,
    `One-line goal: ${group.oneLineGoal ?? "Not set"}`,
    `North Star: ${group.northStar ?? "Not set"}`,
    "Operating metrics:",
    formatList(group.operatingMetrics),
    "Guardrail metrics:",
    formatList(group.guardrailMetrics),
    tailEvents.length > 0 ? "Recent transcript events:" : "",
    ...tailEvents.map((event) => `- ${event.direction ?? "event"} ${event.authorLabel ?? event.authorId ?? "unknown"}: ${String(event.content ?? "").slice(0, 240)}`),
    "</clawclave_group_context>"
  ].filter((line) => line !== "").join("\n");
}

function buildUnmappedContext({ ids, onboardingState }) {
  return [
    `<clawclave_unmapped_channel channel_id="${ids.channelId ?? ""}" guild_id="${ids.guildId ?? ""}">`,
    "This Discord channel is not registered in the group goals source of truth.",
    `Onboarding status: ${onboardingState?.status ?? "pending_goal"}`,
    "If a response is needed, ask the human to confirm: slug, group name, one-line goal, north star, two operating metrics, and two guardrail metrics.",
    "Do not invent durable group goals without human confirmation.",
    "</clawclave_unmapped_channel>"
  ].join("\n");
}

export function buildPromptHookDecision({ root, event = {}, ctx = {}, config = {} }) {
  const normalizedConfig = normalizePluginConfig(config);
  if (!normalizedConfig.promptContext) return { decision: undefined, audit: { loaded: false, reason: "prompt context disabled" } };
  if (!isDiscordHookContext(ctx)) return { decision: undefined, audit: { loaded: false, reason: "not a Discord run" } };

  const ids = resolveDiscordIds(event, ctx);
  const goals = loadGoals(root, normalizedConfig);
  const group = resolveGroup(goals, ids);
  const onboardingResult = ensureOnboardingState({ root, config: normalizedConfig, ids, event, group });
  const onboardingPath = onboardingResult.path ?? (ids.channelId ? resolve(resolvePath(root, normalizedConfig.onboardingDir), `${ids.channelId}.json`) : undefined);
  const onboardingState = onboardingPath ? readJson(onboardingPath, null) : null;
  const transcript = group || ids.channelId
    ? transcriptFile(root, normalizedConfig, group, ids, new Date().toISOString())
    : null;
  const tailEvents = transcript ? readLastJsonlEvents(transcript, normalizedConfig.tailEvents) : [];
  const text = group
    ? buildMappedContext({ group, ids, tailEvents })
    : buildUnmappedContext({ ids, onboardingState });

  return {
    decision: { appendSystemContext: text },
    audit: {
      loaded: true,
      groupSlug: group?.slug,
      unmapped: !group,
      resolvedBy: group ? "channelId" : "unmapped-channel",
      channelId: ids.channelId
    }
  };
}
