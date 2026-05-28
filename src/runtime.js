import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const CHECKPOINTS = {
  discordInput: "discord_input",
  openclawInput: "openclaw_input",
  openclawOutput: "openclaw_output",
  discordOutput: "discord_output"
};

const DEFAULT_CONFIG = {
  goalsFile: "workspace/groups/company-goals.json",
  memoryDir: "memory/clawclave",
  onboardingDir: "workspace/groups/onboarding/active",
  hostedTurnsDir: "workspace/groups/discussions/active",
  eventsDir: "workspace/groups/discussions/events",
  agentRoleMapFile: "workspace/agents/discord-agent-roles.json",
  hostAccountId: "host",
  promptContext: true,
  transcriptWriter: true,
  onboarding: true,
  hostedTurns: true,
  hostedTurnMinWaitSeconds: 45,
  hostedTurnMaxWaitSeconds: 120,
  tailEvents: 12,
  discordRawJournal: true,
  openclawTurnJournal: true,
  catchup: {
    enabled: true,
    initialDelayMinutes: 10,
    lookbackMinutes: 180,
    intervalMinutes: 10,
    maxPagesPerChannel: 4
  },
  selfCheck: {
    enabled: true,
    initialDelayMinutes: 15,
    intervalHours: 24,
    setupChannelId: "1477547786349187155",
    threadName: "Clawclave daily persistence audit"
  }
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
  writeFileSync(path, `${JSON.stringify(makeJsonSafe(value), null, 2)}\n`);
}

function appendJsonlUnique(path, record, key) {
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const marker = key ? `"dedupeKey":${JSON.stringify(key)}` : undefined;
  if (marker && existing.includes(marker)) {
    return { appended: false, duplicate: true, file: path };
  }
  appendFileSync(path, `${JSON.stringify(makeJsonSafe({ dedupeKey: key, ...record }))}\n`);
  return { appended: true, duplicate: false, file: path };
}

function makeJsonSafe(value, seen = new WeakSet(), depth = 0) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return undefined;
  if (value instanceof Date) return value.toISOString();
  if (depth > 12) return "[MaxDepth]";
  if (Array.isArray(value)) return value.map((item) => makeJsonSafe(item, seen, depth + 1));
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      const safe = makeJsonSafe(item, seen, depth + 1);
      if (typeof safe !== "undefined") output[key] = safe;
    }
    seen.delete(value);
    return output;
  }
  return String(value);
}

function simpleHash(value) {
  const text = String(value ?? "");
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  return (hash >>> 0).toString(36);
}

function appendJsonArrayRecord(path, key, record, match) {
  const existing = readJson(path, { version: 1, [key]: [] });
  const values = Array.isArray(existing[key]) ? existing[key] : [];
  const index = values.findIndex(match);
  const nextValues = index >= 0
    ? values.map((value, valueIndex) => valueIndex === index ? { ...value, ...record } : value)
    : [...values, record];
  writeJson(path, { ...existing, [key]: nextValues });
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

function normalizeCatchupConfig(value) {
  const config = isObject(value) ? value : {};
  return {
    enabled: config.enabled !== false,
    initialDelayMinutes: clampInteger(config.initialDelayMinutes, DEFAULT_CONFIG.catchup.initialDelayMinutes, 1, 1440),
    lookbackMinutes: clampInteger(config.lookbackMinutes, DEFAULT_CONFIG.catchup.lookbackMinutes, 1, 10080),
    intervalMinutes: clampInteger(config.intervalMinutes, DEFAULT_CONFIG.catchup.intervalMinutes, 1, 1440),
    maxPagesPerChannel: clampInteger(config.maxPagesPerChannel, DEFAULT_CONFIG.catchup.maxPagesPerChannel, 1, 20)
  };
}

function normalizeSelfCheckConfig(value) {
  const config = isObject(value) ? value : {};
  return {
    enabled: config.enabled !== false,
    initialDelayMinutes: clampInteger(config.initialDelayMinutes, DEFAULT_CONFIG.selfCheck.initialDelayMinutes, 1, 1440),
    intervalHours: clampInteger(config.intervalHours, DEFAULT_CONFIG.selfCheck.intervalHours, 1, 24 * 30),
    setupChannelId: firstString(config.setupChannelId) ?? DEFAULT_CONFIG.selfCheck.setupChannelId,
    threadName: firstString(config.threadName) ?? DEFAULT_CONFIG.selfCheck.threadName
  };
}

export function normalizePluginConfig(value = {}) {
  const config = isObject(value) ? value : {};
  return {
    rootDir: firstString(config.rootDir),
    goalsFile: firstString(config.goalsFile) ?? DEFAULT_CONFIG.goalsFile,
    memoryDir: firstString(config.memoryDir) ?? DEFAULT_CONFIG.memoryDir,
    onboardingDir: firstString(config.onboardingDir) ?? DEFAULT_CONFIG.onboardingDir,
    hostedTurnsDir: firstString(config.hostedTurnsDir) ?? DEFAULT_CONFIG.hostedTurnsDir,
    eventsDir: firstString(config.eventsDir) ?? DEFAULT_CONFIG.eventsDir,
    agentRoleMapFile: firstString(config.agentRoleMapFile) ?? DEFAULT_CONFIG.agentRoleMapFile,
    hostAccountId: firstString(config.hostAccountId) ?? DEFAULT_CONFIG.hostAccountId,
    promptContext: config.promptContext !== false,
    transcriptWriter: config.transcriptWriter !== false,
    onboarding: config.onboarding !== false,
    hostedTurns: config.hostedTurns !== false,
    hostedTurnMinWaitSeconds: clampInteger(config.hostedTurnMinWaitSeconds, DEFAULT_CONFIG.hostedTurnMinWaitSeconds, 0, 600),
    hostedTurnMaxWaitSeconds: clampInteger(config.hostedTurnMaxWaitSeconds, DEFAULT_CONFIG.hostedTurnMaxWaitSeconds, 10, 3600),
    tailEvents: clampInteger(config.tailEvents, DEFAULT_CONFIG.tailEvents, 0, 50),
    discordRawJournal: config.discordRawJournal !== false,
    openclawTurnJournal: config.openclawTurnJournal !== false,
    catchup: normalizeCatchupConfig(config.catchup),
    selfCheck: normalizeSelfCheckConfig(config.selfCheck)
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
    if (raw && typeof raw === "object") return makeJsonSafe(raw);
  } catch {
    return {};
  }
  return isObject(event) ? makeJsonSafe(event) : {};
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

function rawInboundFile(root, config, ids, timestamp) {
  const memoryRoot = resolvePath(root, config.memoryDir);
  const scope = ids.guildId
    ? `discord/raw/guilds/${ids.guildId}/channels/${ids.channelId ?? "unknown"}`
    : `discord/raw/dms/${ids.channelId ?? "unknown"}`;
  const threadPart = ids.threadId ? `/threads/${ids.threadId}` : "";
  return resolve(memoryRoot, scope + threadPart, "events", `${monthFromTimestamp(timestamp)}.jsonl`);
}

function rawOutboundFile(root, config, ids, timestamp) {
  const memoryRoot = resolvePath(root, config.memoryDir);
  const accountId = ids.accountId ?? "unknown";
  const channelId = ids.channelId ?? "unknown";
  const threadPart = ids.threadId ? `/threads/${ids.threadId}` : "";
  return resolve(memoryRoot, `discord/raw/outbound/accounts/${accountId}/channels/${channelId}${threadPart}/events`, `${monthFromTimestamp(timestamp)}.jsonl`);
}

function openclawTurnFile(root, config, input) {
  const memoryRoot = resolvePath(root, config.memoryDir);
  const accountId = input.accountId ?? input.agentId ?? "unknown";
  const sessionKey = safeSlug(input.sessionKey ?? input.channelId ?? input.threadId ?? "unknown");
  return resolve(memoryRoot, `openclaw/turns/discord/accounts/${accountId}/sessions/${sessionKey}`, `${monthFromTimestamp(input.timestamp)}.jsonl`);
}

function transcriptDedupeKey(input) {
  const stableId = input.messageId ?? simpleHash([input.timestamp, input.authorId, input.agentId, input.channelId, input.content].join("|"));
  return `transcript:${input.provider}:${input.direction}:${input.channelId ?? "unknown"}:${stableId}`;
}

function rawDedupeKey(input, phase = "raw") {
  const stableId = input.messageId ?? simpleHash([input.timestamp, input.authorId, input.channelId, input.content].join("|"));
  return `${phase}:${input.provider}:${input.direction}:${input.channelId ?? "unknown"}:${stableId}`;
}

function turnDedupeKey(input, phase) {
  const stableId = input.messageId ?? input.runId ?? simpleHash([input.timestamp, input.agentId, input.authorId, input.channelId, input.content].join("|"));
  return `openclaw-turn:${phase}:${input.provider}:${input.direction}:${input.accountId ?? input.agentId ?? "unknown"}:${input.channelId ?? "unknown"}:${stableId}`;
}

function appendNormalizedTranscript({ root, config, goals, input }) {
  if (!config.transcriptWriter) return { appended: false, reason: "transcript writer disabled" };
  const group = resolveGroup(goals, input);
  const file = transcriptFile(root, config, group, input, input.timestamp);
  const result = appendJsonlUnique(file, { ...input, groupSlug: group?.slug }, transcriptDedupeKey(input));
  return { ...result, groupSlug: group?.slug, channelId: input.channelId, group };
}

function appendDiscordRawInboundJournal({ root, config, input, event = {}, source = "hook" }) {
  if (!config.discordRawJournal) return { appended: false, reason: "raw journal disabled" };
  const file = rawInboundFile(root, config, input, input.timestamp);
  return appendJsonlUnique(
    file,
    {
      ...input,
      checkpoint: CHECKPOINTS.discordInput,
      checkpointSource: source,
      source,
      raw: readDiscordRawMessageData(event)
    },
    rawDedupeKey(input, "discord-raw-inbound")
  );
}

function appendDiscordRawOutboundJournal({ root, config, input, event = {}, phase = "sent" }) {
  if (!config.discordRawJournal) return { appended: false, reason: "raw journal disabled" };
  const file = rawOutboundFile(root, config, input, input.timestamp);
  return appendJsonlUnique(
    file,
    {
      ...input,
      checkpoint: CHECKPOINTS.discordOutput,
      checkpointSource: phase,
      phase,
      raw: isObject(event) ? event : {}
    },
    rawDedupeKey(input, `discord-raw-outbound-${phase}`)
  );
}

function appendOpenClawTurnJournal({ root, config, input, phase, event = {}, ctx = {}, outcome }) {
  if (!config.openclawTurnJournal) return { appended: false, reason: "turn journal disabled" };
  const file = openclawTurnFile(root, config, input);
  const checkpoint = phase === "accepted_input"
    ? CHECKPOINTS.openclawInput
    : phase === "output_intent"
      ? CHECKPOINTS.openclawOutput
      : CHECKPOINTS.discordOutput;
  return appendJsonlUnique(
    file,
    {
      ...input,
      checkpoint,
      checkpointSource: phase,
      phase,
      outcome,
      runId: input.runId,
      context: {
        agentId: firstString(ctx.agentId, ctx.agent_id, input.agentId),
        messageProvider: firstString(ctx.messageProvider, ctx.provider, input.provider),
        hook: phase
      },
      eventShape: Object.keys(isObject(event) ? event : {}).sort()
    },
    turnDedupeKey(input, phase)
  );
}

function buildSyntheticDiscordOutputInput(input, content, options = {}) {
  const accountId = firstString(options.accountId, input.accountId, input.agentId);
  return {
    version: 1,
    timestamp: firstString(options.timestamp, input.timestamp) ?? new Date().toISOString(),
    direction: "outbound",
    provider: "discord",
    source: firstString(options.source) ?? "clawclave-onboarding",
    accountId,
    agentId: firstString(options.agentId, accountId),
    sessionKey: firstString(options.sessionKey, input.sessionKey) ?? (accountId && input.channelId ? `agent:${accountId}:discord:channel:${input.channelId}` : undefined),
    guildId: input.guildId,
    channelId: input.channelId,
    threadId: input.threadId,
    messageId: firstString(options.messageId),
    authorId: firstString(options.authorId),
    content: content ?? ""
  };
}

function recordOnboardingOutputIntent({ root, config, input, content, state, now }) {
  const outputInput = buildSyntheticDiscordOutputInput(input, content, {
    accountId: config.hostAccountId,
    messageId: `${input.messageId ?? simpleHash(input.content)}:onboarding-visible-prompt`,
    timestamp: now,
    source: "clawclave-onboarding-intent"
  });
  const turnJournal = appendOpenClawTurnJournal({
    root,
    config,
    input: outputInput,
    phase: "output_intent",
    event: { content, triggerMessageId: input.messageId, source: "clawclave-onboarding" },
    ctx: { messageProvider: "discord", agentId: config.hostAccountId }
  });
  state.pendingVisiblePrompt = {
    content,
    triggerMessageId: input.messageId,
    intentMessageId: outputInput.messageId,
    accountId: config.hostAccountId,
    sessionKey: outputInput.sessionKey,
    createdAt: now
  };
  return { turnJournal, outputInput };
}

function recordOnboardingOutputDelivery({ root, config, goals, input, event, state }) {
  const pending = isObject(state?.pendingVisiblePrompt) ? state.pendingVisiblePrompt : null;
  if (!pending?.content || input.authorType !== "bot") return { matched: false };
  if (String(input.content ?? "") !== String(pending.content ?? "")) return { matched: false };
  const outputInput = buildSyntheticDiscordOutputInput(input, pending.content, {
    accountId: pending.accountId ?? config.hostAccountId,
    agentId: pending.accountId ?? config.hostAccountId,
    sessionKey: pending.sessionKey,
    messageId: input.messageId,
    timestamp: input.timestamp,
    authorId: input.authorId,
    source: "clawclave-onboarding-delivery"
  });
  const transcript = appendNormalizedTranscript({ root, config, goals, input: outputInput });
  const rawJournal = appendDiscordRawOutboundJournal({ root, config, input: outputInput, event, phase: "sent" });
  const turnJournal = appendOpenClawTurnJournal({
    root,
    config,
    input: outputInput,
    phase: "output_result",
    event,
    ctx: { messageProvider: "discord", agentId: pending.accountId ?? config.hostAccountId },
    outcome: { matchedPendingVisiblePrompt: true, triggerMessageId: pending.triggerMessageId }
  });
  state.pendingVisiblePrompt = {
    ...pending,
    deliveredAt: new Date().toISOString(),
    deliveredMessageId: input.messageId
  };
  return { matched: true, transcript, rawJournal, turnJournal, outputInput };
}

function loadAgentRoleMap(root, config) {
  const roleMap = readJson(resolvePath(root, config.agentRoleMapFile), { roles: [] });
  return Array.isArray(roleMap.roles) ? roleMap.roles : [];
}

function extractDiscordMentionIds(text) {
  const userIds = new Set();
  const roleIds = new Set();
  for (const match of String(text ?? "").matchAll(/<@!?(\d+)>/g)) userIds.add(match[1]);
  for (const match of String(text ?? "").matchAll(/<@&(\d+)>/g)) roleIds.add(match[1]);
  return { userIds, roleIds };
}

function resolveMentionedAgents(text, roles, hostAccountId) {
  const { userIds, roleIds } = extractDiscordMentionIds(text);
  const byAccount = new Map();
  for (const role of roles) {
    const accountId = firstString(role.accountId);
    if (!accountId || accountId === hostAccountId) continue;
    if (userIds.has(firstString(role.botUserId)) || roleIds.has(firstString(role.roleId))) {
      byAccount.set(accountId, {
        accountId,
        displayName: firstString(role.displayName, role.roleName, role.accountId),
        botUserId: firstString(role.botUserId),
        roleId: firstString(role.roleId)
      });
    }
  }
  return [...byAccount.values()];
}

function looksLikeHostedTurnRequest(text) {
  const value = String(text ?? "");
  if (!value.trim()) return false;
  return /(各|每人|每位|一人|回复|回答|看下|看一下|查证|查一下|复核|评估|参赛|提交|本轮|下一轮|讨论|大赛|比赛|请|你来|帮忙|reply|review|research|round|each|discuss|contest)/i.test(value);
}

function hostedTurnScopeId(ids = {}) {
  return ids.threadId || ids.channelId;
}

function activeHostedTurnPath(root, config, ids = {}) {
  const scopeId = hostedTurnScopeId(ids);
  if (!scopeId) return undefined;
  return resolve(resolvePath(root, config.hostedTurnsDir), `${safeSlug(scopeId)}.json`);
}

function appendDiscussionEvent(root, config, event) {
  const now = new Date();
  const file = resolve(resolvePath(root, config.eventsDir), `${monthFromTimestamp(now.toISOString())}.jsonl`);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ timestamp: now.toISOString(), ...event })}\n`);
}

function readActiveHostedTurn(root, config, ids = {}) {
  const path = activeHostedTurnPath(root, config, ids);
  if (!path) return { path: undefined, state: null };
  const state = readJson(path, null);
  if (!state || typeof state !== "object") return { path, state: null };
  return { path, state };
}

function isHostedTurnFresh(state) {
  if (!state || state.status !== "open") return false;
  const deadline = Date.parse(state.deadlineAt ?? "");
  if (!Number.isFinite(deadline)) return true;
  return Date.now() <= deadline + 5 * 60 * 1000;
}

function updateHostedTurnFromOutbound({ root, config, input }) {
  if (!config.hostedTurns || input.direction !== "outbound") return { opened: false, reason: "disabled or not outbound" };
  if (input.agentId !== config.hostAccountId) return { opened: false, reason: "not host outbound" };
  if (!input.channelId) return { opened: false, reason: "missing channel id" };
  const content = String(input.content ?? "");
  if (!looksLikeHostedTurnRequest(content)) return { opened: false, reason: "no hosted-turn intent" };
  const roles = loadAgentRoleMap(root, config);
  const expectedAgents = resolveMentionedAgents(content, roles, config.hostAccountId);
  if (expectedAgents.length === 0) return { opened: false, reason: "no mentioned expert agents" };

  const now = new Date();
  const maxWaitMs = Math.max(config.hostedTurnMinWaitSeconds, config.hostedTurnMaxWaitSeconds) * 1000;
  const minWaitMs = Math.min(config.hostedTurnMinWaitSeconds, config.hostedTurnMaxWaitSeconds) * 1000;
  const state = {
    version: 1,
    id: `hosted-${input.threadId || input.channelId}-${input.messageId || now.getTime()}`,
    status: "open",
    mode: expectedAgents.length > 1 ? "hosted-mention" : "single-owner",
    collaboration: expectedAgents.length > 1 ? "parallel" : "single-owner",
    channelId: input.channelId,
    threadId: input.threadId,
    originMessageId: input.messageId,
    hostAccountId: config.hostAccountId,
    expectedAgents,
    receivedAgents: [],
    receivedMessageIds: [],
    openedAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    summaryEligibleAt: new Date(now.getTime() + minWaitMs).toISOString(),
    deadlineAt: new Date(now.getTime() + maxWaitMs).toISOString(),
    summaryStarted: false,
    policy: {
      preferSilenceOverNoise: true,
      expectedRepliesPerAgent: 1,
      summary: "host decides after all expected replies, expected-1 after min wait, or max wait"
    },
    promptPreview: content.slice(0, 500)
  };
  const path = activeHostedTurnPath(root, config, input);
  writeJson(path, state);
  appendDiscussionEvent(root, config, {
    type: "host-opened",
    channelId: input.channelId,
    threadId: input.threadId ?? null,
    messageId: input.messageId,
    stateId: state.id,
    actor: config.hostAccountId,
    targetAgent: expectedAgents.map((agent) => agent.accountId).join(","),
    workType: expectedAgents.length > 1 ? "discussion" : "qa",
    surface: input.threadId ? "thread" : "channel",
    collaboration: state.collaboration,
    questionSummary: content.slice(0, 160),
    action: "opened-state",
    reviewTags: ["hosted-mention", "prefer-silence"]
  });
  for (const agent of expectedAgents) {
    appendDiscussionEvent(root, config, {
      type: "participant-assigned",
      channelId: input.channelId,
      threadId: input.threadId ?? null,
      messageId: input.messageId,
      stateId: state.id,
      actor: config.hostAccountId,
      targetAgent: agent.accountId,
      workType: expectedAgents.length > 1 ? "discussion" : "qa",
      surface: input.threadId ? "thread" : "channel",
      collaboration: state.collaboration,
      questionSummary: content.slice(0, 160),
      action: "assigned",
      reviewTags: ["hosted-mention"]
    });
  }
  return { opened: true, path, state };
}

function updateHostedTurnFromInbound({ root, config, input }) {
  if (!config.hostedTurns || input.direction !== "inbound") {
    return { updated: false, reason: "not hosted inbound" };
  }
  const { path, state } = readActiveHostedTurn(root, config, input);
  if (!path || !isHostedTurnFresh(state)) return { updated: false, reason: "no fresh open turn" };
  const expectedAgents = Array.isArray(state.expectedAgents) ? state.expectedAgents : [];
  const agent = expectedAgents.find((entry) => entry?.botUserId === input.authorId || entry?.accountId === input.agentId);
  if (!agent) return { updated: false, reason: "unexpected bot" };
  if (Array.isArray(state.receivedAgents) && state.receivedAgents.includes(agent.accountId)) {
    return { updated: false, reason: "already received" };
  }
  const now = new Date().toISOString();
  state.receivedAgents = [...(Array.isArray(state.receivedAgents) ? state.receivedAgents : []), agent.accountId];
  state.receivedMessageIds = [...(Array.isArray(state.receivedMessageIds) ? state.receivedMessageIds : []), input.messageId].filter(Boolean);
  state.lastActivityAt = now;
  state.replies = [
    ...(Array.isArray(state.replies) ? state.replies : []),
    {
      agentId: agent.accountId,
      botUserId: agent.botUserId,
      messageId: input.messageId,
      receivedAt: now,
      preview: String(input.content ?? "").slice(0, 240)
    }
  ];
  writeJson(path, state);
  appendDiscussionEvent(root, config, {
    type: "participant-replied",
    channelId: input.channelId,
    threadId: input.threadId ?? null,
    messageId: input.messageId,
    stateId: state.id,
    actor: `bot:${agent.accountId}`,
    targetAgent: config.hostAccountId,
    workType: state.mode === "single-owner" ? "qa" : "discussion",
    surface: input.threadId ? "thread" : "channel",
    collaboration: state.collaboration,
    questionSummary: "",
    action: "replied",
    reviewTags: ["hosted-mention"]
  });
  return { updated: true, path, state, agentId: agent.accountId };
}

export function buildMessageInput({ event = {}, ctx = {}, direction = "inbound" }) {
  const ids = resolveDiscordIds(event, ctx);
  const metadata = isObject(event.metadata) ? event.metadata : {};
  const accountId = firstString(
    event.accountId,
    event.account_id,
    metadata.accountId,
    metadata.account_id,
    ctx.accountId,
    ctx.account_id,
    ctx.agentId,
    ctx.agent_id
  );
  return {
    version: 1,
    timestamp: firstString(event.timestamp, event.createdAt, metadata.timestamp) ?? new Date().toISOString(),
    direction,
    provider: "discord",
    source: "openclaw-hook",
    accountId,
    sessionKey: firstString(event.sessionKey, event.session_key, metadata.sessionKey, ctx.sessionKey, ctx.session_id, ids.threadId, ids.channelId),
    runId: firstString(event.runId, event.run_id, metadata.runId, metadata.run_id, ctx.runId, ctx.run_id),
    guildId: ids.guildId,
    channelId: ids.channelId,
    threadId: ids.threadId,
    messageId: ids.messageId,
    authorId: firstString(event.authorId, event.author_id, ids.senderId, metadata.authorId),
    authorLabel: firstString(event.authorLabel, event.author_label, event.senderName, metadata.authorLabel),
    authorType: event.authorType ?? (direction === "outbound" ? "agent" : undefined),
    agentId: direction === "outbound" ? firstString(ctx.agentId, ctx.agent_id) : firstString(event.agentId, event.agent_id),
    replyToId: firstString(event.replyToId, event.reply_to_id, metadata.replyToId, metadata.reply_to_id),
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
    "1. slug（小写短横线，例如 ops-lab）",
    "2. 群名称",
    "3. 一句话目标",
    "4. North Star",
    "5. 两个运营指标",
    "6. 两个护栏指标"
  ].join("\n");
}

function isSubstantiveOnboardingText(content) {
  const text = String(content ?? "").trim();
  if (!text) return false;
  if (/^(hi|hello|hey|test|ping|在吗)[.!。！?？\s]*$/i.test(text)) return false;
  return text.length >= 12 || text.includes("\n") || /(目标|讨论|维护|研究|项目|一起|公司|community|project|team|ops|research|ai)/i.test(text);
}

function inferOnboardingGroup(input, state = {}) {
  const content = String(input.content ?? "").trim();
  const slugMatch = content.match(/(?:^|\n)\s*slug\s*[:：]\s*([a-z0-9][a-z0-9-]{1,60})\s*(?:\n|$)/i);
  const nameMatch = content.match(/(?:群名称|name)\s*[:：]\s*([^\n]{2,80})/i);
  const fallbackSlug = `group-${String(input.channelId ?? "unknown").slice(-6)}`;
  const slug = safeSlug(slugMatch?.[1] ?? state.slug ?? fallbackSlug);
  const name = firstString(nameMatch?.[1], state.name, `Group ${String(input.channelId ?? "unknown").slice(-6)}`);
  const oneLineGoal = `Maintain a focused group workspace around: ${content.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 160) ?? "the confirmed group topic"}.`;
  return {
    slug,
    name,
    channelId: input.channelId,
    doc: `workspace/groups/${slug}/IDENTITY.md`,
    oneLineGoal,
    northStar: "Useful group conversations that produce clear notes, decisions, or next actions.",
    operatingMetrics: [
      "Messages that clarify the question, context, and next step.",
      "Useful notes or decisions captured when the group converges."
    ],
    guardrailMetrics: [
      "Unclear group purpose after onboarding.",
      "Uncaptured decisions or repeated context resets."
    ]
  };
}

function writeGroupWorkspace(root, group) {
  const dir = resolve(root, "workspace/groups", group.slug);
  mkdirSync(resolve(dir, "sessions"), { recursive: true });
  const identity = [
    `# ${group.name}`,
    "",
    `Channel ID: ${group.channelId}`,
    "",
    "## One-Line Goal",
    "",
    group.oneLineGoal,
    "",
    "## North Star",
    "",
    group.northStar,
    "",
    "## Operating Metrics",
    "",
    ...group.operatingMetrics.map((metric) => `- ${metric}`),
    "",
    "## Guardrail Metrics",
    "",
    ...group.guardrailMetrics.map((metric) => `- ${metric}`),
    ""
  ].join("\n");
  writeFileSync(resolve(dir, "IDENTITY.md"), identity);
  for (const file of ["AGENTS.md", "HEARTBEAT.md", "MEMORY.md", "SOUL.md", "USER.md"]) {
    const path = resolve(dir, file);
    if (!existsSync(path)) writeFileSync(path, `# ${group.name}\n\nSee IDENTITY.md for the current group contract.\n`);
  }
  const sessionsPath = resolve(dir, "sessions/sessions.json");
  if (!existsSync(sessionsPath)) writeJson(sessionsPath, { version: 1, sessions: [] });
  const gitkeep = resolve(dir, "sessions/.gitkeep");
  if (!existsSync(gitkeep)) writeFileSync(gitkeep, "");
}

function buildOnboardingConfiguredPrompt(group) {
  return [
    `已初始化 ${group.name}（${group.slug}）。`,
    "",
    `目标：${group.oneLineGoal}`,
    `North Star：${group.northStar}`,
    "",
    "之后这个群会按这个目标组织讨论；要改目标，直接说“修改群目标”。"
  ].join("\n");
}

function buildOnboardingReminderPrompt() {
  return "这个群还在等待目标确认。请发一句话目标、North Star、两个运营指标和两个护栏指标；如果让我定，可以直接说主题和“其他你定”。";
}

export function recordDiscordRawIngress({ root, event = {}, accountId, config = {} }) {
  const normalizedConfig = normalizePluginConfig(config);
  const input = buildRawIngressInput({ event, accountId });
  if (!input.channelId || !input.messageId) {
    return { handled: false, reason: "not a Discord channel message", input };
  }

  const goals = loadGoals(root, normalizedConfig);
  const group = resolveGroup(goals, input);
  const rawJournal = appendDiscordRawInboundJournal({ root, config: normalizedConfig, input, event, source: "discord-raw-ingress" });
  const transcript = appendNormalizedTranscript({ root, config: normalizedConfig, goals, input });
  const hostedTurn = updateHostedTurnFromInbound({ root, config: normalizedConfig, input });
  if (!normalizedConfig.onboarding) {
    return { handled: true, reason: "onboarding disabled", mapped: Boolean(group), groupSlug: group?.slug, input, rawJournal, transcript, hostedTurn };
  }
  if (group) return { handled: true, mapped: true, groupSlug: group.slug, input, rawJournal, transcript, hostedTurn };

  const onboardingDir = resolvePath(root, normalizedConfig.onboardingDir);
  const statePath = resolve(onboardingDir, `${input.channelId}.json`);
  const previous = readJson(statePath, null);
  const now = new Date().toISOString();
  const hostAccountId = normalizedConfig.hostAccountId;
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

  const outputDelivery = recordOnboardingOutputDelivery({ root, config: normalizedConfig, goals, input, event, state });
  if (outputDelivery.matched) {
    state.updatedAt = now;
    state.lastSeenAt = now;
    state.lastMessageId = input.messageId;
    state.lastSeenByAccountId = accountId;
    writeJson(statePath, state);
    return { handled: true, mapped: false, created: !previous, path: statePath, state, input, rawJournal, transcript, hostedTurn, outputDelivery };
  }

  if (previous && accountId !== hostAccountId) {
    return { handled: true, mapped: false, created: false, path: statePath, state: previous, input, rawJournal, transcript, hostedTurn };
  }

  state.updatedAt = now;
  state.lastSeenAt = now;
  state.lastMessageId = input.messageId;
  state.lastSeenByAccountId = accountId;

  const shouldPrompt = accountId === hostAccountId && !state.promptedAt && input.authorType !== "bot";
  let visiblePrompt;
  let outputIntent;
  if (shouldPrompt) {
    state.promptedAt = now;
    state.promptedByAccountId = accountId;
    state.promptedForMessageId = input.messageId;
    visiblePrompt = buildOnboardingVisiblePrompt(input);
    outputIntent = recordOnboardingOutputIntent({ root, config: normalizedConfig, input, content: visiblePrompt, state, now });
  } else if (accountId === hostAccountId && input.authorType !== "bot" && state.status === "pending_goal" && state.promptedAt) {
    if (isSubstantiveOnboardingText(input.content)) {
      const groupRecord = inferOnboardingGroup(input, state);
      appendJsonArrayRecord(resolvePath(root, normalizedConfig.goalsFile), "groups", groupRecord, (group) => firstString(group.channelId) === input.channelId || safeSlug(group.slug) === groupRecord.slug);
      writeGroupWorkspace(root, groupRecord);
      state.status = "configured";
      state.completedAt = now;
      state.groupSlug = groupRecord.slug;
      state.groupName = groupRecord.name;
      state.goalMessageId = input.messageId;
      state.goalMessagePreview = String(input.content ?? "").slice(0, 500);
      visiblePrompt = buildOnboardingConfiguredPrompt(groupRecord);
      outputIntent = recordOnboardingOutputIntent({ root, config: normalizedConfig, input, content: visiblePrompt, state, now });
    } else {
      const lastReminderAt = Date.parse(state.lastReminderAt ?? "");
      if (!Number.isFinite(lastReminderAt) || Date.now() - lastReminderAt > 10 * 60 * 1000) {
        state.lastReminderAt = now;
        visiblePrompt = buildOnboardingReminderPrompt();
        outputIntent = recordOnboardingOutputIntent({ root, config: normalizedConfig, input, content: visiblePrompt, state, now });
      }
    }
  }
  writeJson(statePath, state);

  return {
    handled: true,
    mapped: false,
    created: !previous,
    path: statePath,
    state,
    input,
    rawJournal,
    transcript,
    hostedTurn,
    visiblePrompt,
    outputIntent
  };
}

export function appendHookTranscriptEvent({ root, event = {}, ctx = {}, config = {}, direction = "inbound" }) {
  const normalizedConfig = normalizePluginConfig(config);
  if (!isDiscordHookContext(ctx)) return { appended: false, reason: "not a Discord hook context" };

  const goals = loadGoals(root, normalizedConfig);
  const input = buildMessageInput({ event, ctx, direction });
  const group = resolveGroup(goals, input);
  ensureOnboardingState({ root, config: normalizedConfig, ids: input, event, group });

  const rawJournal = direction === "inbound"
    ? appendDiscordRawInboundJournal({ root, config: normalizedConfig, input, event, source: "message_received" })
    : { appended: false, reason: "not inbound" };
  const transcript = appendNormalizedTranscript({ root, config: normalizedConfig, goals, input });
  const hostedTurn = direction === "outbound"
    ? updateHostedTurnFromOutbound({ root, config: normalizedConfig, input })
    : updateHostedTurnFromInbound({ root, config: normalizedConfig, input });
  const phase = direction === "outbound" ? "output_result" : "accepted_input";
  const turnJournal = appendOpenClawTurnJournal({ root, config: normalizedConfig, input, phase, event, ctx });
  return {
    appended: Boolean(transcript.appended),
    duplicate: Boolean(transcript.duplicate),
    file: transcript.file,
    groupSlug: group?.slug,
    channelId: input.channelId,
    hostedTurn,
    rawJournal,
    turnJournal
  };
}

export function recordOpenClawOutputIntent({ root, event = {}, ctx = {}, config = {} }) {
  const normalizedConfig = normalizePluginConfig(config);
  if (!isDiscordHookContext(ctx)) return { recorded: false, reason: "not a Discord hook context" };
  const input = buildMessageInput({ event, ctx, direction: "outbound" });
  const turnJournal = appendOpenClawTurnJournal({ root, config: normalizedConfig, input, phase: "output_intent", event, ctx });
  return { recorded: Boolean(turnJournal.appended), duplicate: Boolean(turnJournal.duplicate), file: turnJournal.file, channelId: input.channelId };
}

export function recordOpenClawOutboundResult({ root, event = {}, ctx = {}, config = {} }) {
  const normalizedConfig = normalizePluginConfig(config);
  if (!isDiscordHookContext(ctx)) return { recorded: false, reason: "not a Discord hook context" };
  const transcript = appendHookTranscriptEvent({ root, event, ctx, config: normalizedConfig, direction: "outbound" });
  const input = buildMessageInput({ event, ctx, direction: "outbound" });
  const rawJournal = appendDiscordRawOutboundJournal({ root, config: normalizedConfig, input, event, phase: "sent" });
  return {
    recorded: Boolean(transcript.appended || rawJournal.appended),
    duplicate: Boolean(transcript.duplicate && rawJournal.duplicate),
    file: transcript.file,
    groupSlug: transcript.groupSlug,
    channelId: input.channelId,
    hostedTurn: transcript.hostedTurn,
    rawJournal,
    turnJournal: transcript.turnJournal
  };
}

function discordAuthHeader(token) {
  const text = firstString(token);
  if (!text) return undefined;
  return /^Bot\s+/i.test(text) ? text : `Bot ${text}`;
}

async function fetchDiscordJson(path, token, options = {}) {
  const authorization = discordAuthHeader(token);
  if (!authorization) throw new Error("missing Discord token");
  const url = path.startsWith("http") ? path : `https://discord.com/api/v10${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text.slice(0, 240) || response.statusText || "non-json response" };
  }
  if (!response.ok) {
    const message = typeof body?.message === "string" ? body.message : response.statusText;
    throw new Error(`Discord API ${response.status}: ${message}`);
  }
  return body;
}

function collectDiscordChannelIds(discordConfig = {}, selfCheck = {}) {
  const channelIds = new Set();
  for (const guild of Object.values(isObject(discordConfig.guilds) ? discordConfig.guilds : {})) {
    for (const channelId of Object.keys(isObject(guild?.channels) ? guild.channels : {})) channelIds.add(channelId);
  }
  for (const account of Object.values(isObject(discordConfig.accounts) ? discordConfig.accounts : {})) {
    for (const guild of Object.values(isObject(account?.guilds) ? account.guilds : {})) {
      for (const channelId of Object.keys(isObject(guild?.channels) ? guild.channels : {})) channelIds.add(channelId);
    }
  }
  if (selfCheck.setupChannelId) channelIds.add(selfCheck.setupChannelId);
  return [...channelIds];
}

function addDiscordId(set, value) {
  const id = normalizeDiscordId(value, { allowAlias: false });
  if (/^\d+$/.test(id ?? "")) set.add(id);
}

function collectGoalChannelIds(root, config) {
  const ids = new Set();
  for (const group of loadGoals(root, config).groups) {
    addDiscordId(ids, group.channelId);
    addDiscordId(ids, group.threadId);
  }
  return [...ids];
}

function collectOnboardingChannelIds(root, config) {
  const ids = new Set();
  const dir = resolvePath(root, config.onboardingDir);
  if (!dir || !existsSync(dir)) return [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const state = readJson(resolve(dir, entry.name), {});
    if (!state.guildId && !state.firstMessageId && state.status !== "configured") continue;
    addDiscordId(ids, state.channelId);
    addDiscordId(ids, state.threadId);
    addDiscordId(ids, entry.name.replace(/\.json$/, ""));
  }
  return [...ids];
}

function walkFiles(root, visit) {
  if (!root || !existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) walkFiles(path, visit);
    else if (entry.isFile()) visit(path);
  }
}

function collectMemoryChannelIds(root, config) {
  const ids = new Set();
  const memoryRoot = resolvePath(root, config.memoryDir);
  const hostedTurnsRoot = resolvePath(root, config.hostedTurnsDir);
  if (memoryRoot && existsSync(memoryRoot)) {
    walkFiles(memoryRoot, (file) => {
      const relative = file.slice(memoryRoot.length + 1);
      for (const pattern of [
        /(?:^|\/)discord\/raw\/guilds\/\d+\/channels\/(\d+)(?:\/|$)/g,
        /(?:^|\/)transcripts\/guilds\/\d+\/channels\/(\d+)(?:\/|$)/g,
        /(?:^|\/)transcripts\/groups\/[^/]+\/channels\/(\d+)(?:\/|$)/g,
        /(?:^|\/)threads\/(\d+)(?:\/|$)/g
      ]) {
        for (const match of relative.matchAll(pattern)) addDiscordId(ids, match[1]);
      }
    });
  }
  if (hostedTurnsRoot && existsSync(hostedTurnsRoot)) {
    walkFiles(hostedTurnsRoot, (file) => {
      if (!file.endsWith(".json")) return;
      const state = readJson(file, {});
      addDiscordId(ids, state.channelId);
      addDiscordId(ids, state.threadId);
    });
  }
  return [...ids];
}

function collectDiscordCatchupChannelIds(root, openclawConfig = {}, config = normalizePluginConfig(), options = {}) {
  const discord = openclawConfig?.channels?.discord ?? {};
  const ids = new Set();
  for (const id of collectDiscordChannelIds(discord, config.selfCheck)) addDiscordId(ids, id);
  for (const id of collectGoalChannelIds(root, config)) addDiscordId(ids, id);
  for (const id of collectOnboardingChannelIds(root, config)) addDiscordId(ids, id);
  if (options.includeMemory) {
    for (const id of collectMemoryChannelIds(root, config)) addDiscordId(ids, id);
  }
  return [...ids].sort();
}

function collectDiscordCatchupTargets(root, openclawConfig = {}, config = normalizePluginConfig()) {
  const discord = openclawConfig?.channels?.discord ?? {};
  const accounts = isObject(discord.accounts) ? discord.accounts : {};
  const account = accounts[config.hostAccountId] ?? accounts.default;
  const token = firstString(account?.token);
  const channelIds = collectDiscordCatchupChannelIds(root, openclawConfig, config);
  if (!token || channelIds.length === 0) return [];
  return [{ accountId: config.hostAccountId, token, channelIds }];
}

async function fetchChannelMessagesSince({ token, channelId, sinceMs, maxPages }) {
  const messages = [];
  let before;
  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({ limit: "100" });
    if (before) params.set("before", before);
    const batch = await fetchDiscordJson(`/channels/${channelId}/messages?${params.toString()}`, token);
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const message of batch) {
      const timestampMs = Date.parse(message.timestamp ?? "");
      if (Number.isFinite(timestampMs) && timestampMs >= sinceMs) messages.push(message);
    }
    const oldest = batch[batch.length - 1];
    before = oldest?.id;
    const oldestMs = Date.parse(oldest?.timestamp ?? "");
    if (!before || (Number.isFinite(oldestMs) && oldestMs < sinceMs)) break;
  }
  return messages.reverse();
}

export async function runDiscordCatchup({ root, config = {}, openclawConfig = {}, logger, now = new Date() }) {
  const normalizedConfig = normalizePluginConfig(config);
  if (!normalizedConfig.catchup.enabled) return { skipped: true, reason: "catchup disabled" };
  const sinceMs = now.getTime() - normalizedConfig.catchup.lookbackMinutes * 60 * 1000;
  const targets = collectDiscordCatchupTargets(root, openclawConfig, normalizedConfig);
  const summary = {
    startedAt: now.toISOString(),
    lookbackMinutes: normalizedConfig.catchup.lookbackMinutes,
    targets: targets.length,
    channels: 0,
    fetched: 0,
    rawAppended: 0,
    transcriptAppended: 0,
    duplicates: 0,
    errors: []
  };
  for (const target of targets) {
    for (const channelId of target.channelIds) {
      summary.channels += 1;
      try {
        const messages = await fetchChannelMessagesSince({
          token: target.token,
          channelId,
          sinceMs,
          maxPages: normalizedConfig.catchup.maxPagesPerChannel
        });
        summary.fetched += messages.length;
        for (const message of messages) {
          const result = recordDiscordRawIngress({
            root,
            event: { ...message, channel_id: message.channel_id ?? channelId },
            accountId: target.accountId,
            config: normalizedConfig
          });
          if (result.rawJournal?.appended) summary.rawAppended += 1;
          if (result.transcript?.appended) summary.transcriptAppended += 1;
          if (result.rawJournal?.duplicate || result.transcript?.duplicate) summary.duplicates += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger?.warn?.(`clawclave: catchup failed for channel ${channelId}: ${message}`);
        summary.errors.push({ channelId, message });
      }
    }
  }
  summary.finishedAt = new Date().toISOString();
  const statePath = resolve(resolvePath(root, normalizedConfig.memoryDir), "catchup/state.json");
  writeJson(statePath, { version: 1, lastRun: summary });
  return summary;
}

function truncateDiscordContent(value, maxLength = 1900) {
  const text = String(value ?? "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 20)}\n... [truncated]`;
}

function diffSets(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

export function runDriftAudit({ root, config = {}, openclawConfig = {}, catchup } = {}) {
  const normalizedConfig = normalizePluginConfig(config);
  const discord = openclawConfig?.channels?.discord ?? {};
  const configuredChannels = collectDiscordChannelIds(discord, normalizedConfig.selfCheck).sort();
  const goalChannels = collectGoalChannelIds(root, normalizedConfig).sort();
  const onboardingChannels = collectOnboardingChannelIds(root, normalizedConfig).sort();
  const memoryChannels = collectMemoryChannelIds(root, normalizedConfig).sort();
  const catchupTargets = collectDiscordCatchupChannelIds(root, openclawConfig, normalizedConfig, { includeMemory: true });
  const issues = [];
  const requiredFlags = [
    ["transcriptWriter", normalizedConfig.transcriptWriter],
    ["discordRawJournal", normalizedConfig.discordRawJournal],
    ["openclawTurnJournal", normalizedConfig.openclawTurnJournal],
    ["catchup.enabled", normalizedConfig.catchup.enabled],
    ["selfCheck.enabled", normalizedConfig.selfCheck.enabled]
  ];
  for (const [name, enabled] of requiredFlags) {
    if (!enabled) issues.push({ severity: "error", code: "disabled_persistence_flag", message: `${name} is disabled` });
  }
  for (const [name, path] of [
    ["goalsFile", resolvePath(root, normalizedConfig.goalsFile)],
    ["agentRoleMapFile", resolvePath(root, normalizedConfig.agentRoleMapFile)]
  ]) {
    if (!path || !existsSync(path)) issues.push({ severity: "warning", code: "missing_key_path", message: `${name} is missing`, path });
  }
  if (catchupTargets.length === 0) {
    issues.push({ severity: "error", code: "no_catchup_targets", message: "no Discord channels are available for catchup" });
  }
  const discoveredOutsideConfig = [...new Set([
    ...diffSets(goalChannels, configuredChannels),
    ...diffSets(onboardingChannels, configuredChannels),
    ...diffSets(memoryChannels, configuredChannels)
  ])].sort();
  if (discoveredOutsideConfig.length > 0) {
    issues.push({
      severity: "warning",
      code: "channels_discovered_outside_config",
      message: "channels exist in group/onboarding/memory state but are absent from explicit Discord config",
      channels: discoveredOutsideConfig
    });
  }
  const catchupErrors = Array.isArray(catchup?.errors) ? catchup.errors : [];
  if (catchupErrors.length > 0) {
    issues.push({
      severity: "warning",
      code: "catchup_errors",
      message: "Discord catchup reported channel errors",
      count: catchupErrors.length
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    status: issues.some((issue) => issue.severity === "error") ? "ERROR" : issues.length > 0 ? "WARN" : "OK",
    sources: {
      configuredChannels: configuredChannels.length,
      goalChannels: goalChannels.length,
      onboardingChannels: onboardingChannels.length,
      memoryChannels: memoryChannels.length,
      catchupTargets: catchupTargets.length
    },
    discoveredOutsideConfig,
    checkpointContract: [
      { checkpoint: CHECKPOINTS.discordInput, source: "message_received + Discord REST catchup" },
      { checkpoint: CHECKPOINTS.openclawInput, source: "message_received canonical inbound" },
      { checkpoint: CHECKPOINTS.openclawOutput, source: "message_sending" },
      { checkpoint: CHECKPOINTS.discordOutput, source: "message_sent" }
    ],
    issues
  };
}

export function formatSelfCheckReport(report = {}) {
  const errors = Array.isArray(report.catchup?.errors) ? report.catchup.errors : [];
  const drift = report.drift;
  const driftIssues = Array.isArray(drift?.issues) ? drift.issues : [];
  return [
    "Clawclave daily persistence audit",
    "",
    `Status: ${errors.length === 0 && (!drift || drift.status === "OK") ? "OK" : "NEEDS_ATTENTION"}`,
    `Started: ${report.startedAt ?? "unknown"}`,
    `Catchup lookback: ${report.catchup?.lookbackMinutes ?? "unknown"} minutes`,
    `Channels scanned: ${report.catchup?.channels ?? 0}`,
    `Discord messages fetched: ${report.catchup?.fetched ?? 0}`,
    `Raw inbound appended: ${report.catchup?.rawAppended ?? 0}`,
    `Normalized transcript appended: ${report.catchup?.transcriptAppended ?? 0}`,
    `Duplicates skipped: ${report.catchup?.duplicates ?? 0}`,
    errors.length > 0 ? `Errors: ${errors.slice(0, 5).map((error) => `${error.channelId}: ${error.message}`).join("; ")}` : "Errors: none",
    "",
    `Drift status: ${drift?.status ?? "unknown"}`,
    drift?.sources ? `Drift sources: config=${drift.sources.configuredChannels} goals=${drift.sources.goalChannels} onboarding=${drift.sources.onboardingChannels} memory=${drift.sources.memoryChannels} targets=${drift.sources.catchupTargets}` : "Drift sources: unknown",
    driftIssues.length > 0 ? `Drift issues: ${driftIssues.slice(0, 5).map((issue) => `${issue.severity}/${issue.code}: ${issue.message}`).join("; ")}` : "Drift issues: none",
    "",
    "Self-repair: Discord catchup was executed before this report, and drift targets are merged from config, group goals, onboarding state, and existing memory paths."
  ].join("\n");
}

async function findOrCreateSetupThread({ token, setupChannelId, threadName }) {
  const channel = await fetchDiscordJson(`/channels/${setupChannelId}`, token);
  const guildId = channel?.guild_id;
  if (guildId) {
    const active = await fetchDiscordJson(`/guilds/${guildId}/threads/active`, token);
    const activeThread = Array.isArray(active?.threads) ? active.threads.find((thread) => thread.parent_id === setupChannelId && thread.name === threadName) : undefined;
    if (activeThread?.id) return activeThread.id;
  }
  try {
    const archived = await fetchDiscordJson(`/channels/${setupChannelId}/threads/archived/public?limit=100`, token);
    const archivedThread = Array.isArray(archived?.threads) ? archived.threads.find((thread) => thread.name === threadName) : undefined;
    if (archivedThread?.id) return archivedThread.id;
  } catch {
    // Some channel types or permissions do not expose archived public threads.
  }
  const created = await fetchDiscordJson(`/channels/${setupChannelId}/threads`, token, {
    method: "POST",
    body: JSON.stringify({ name: threadName, auto_archive_duration: 10080, type: 11 })
  });
  return created.id;
}

async function sendSelfCheckReportToSetup({ config, openclawConfig, report }) {
  const discord = openclawConfig?.channels?.discord ?? {};
  const accounts = isObject(discord.accounts) ? discord.accounts : {};
  const account = accounts[config.hostAccountId] ?? accounts.default;
  const token = firstString(account?.token);
  if (!token) return { sent: false, reason: "missing Discord token" };
  const setupChannelId = config.selfCheck.setupChannelId;
  const threadId = await findOrCreateSetupThread({ token, setupChannelId, threadName: config.selfCheck.threadName });
  await fetchDiscordJson(`/channels/${threadId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({ content: truncateDiscordContent(formatSelfCheckReport(report)) })
  });
  return { sent: true, threadId };
}

export async function runDailySelfCheck({ root, config = {}, openclawConfig = {}, logger, force = false, now = new Date(), deliverReport = true }) {
  const normalizedConfig = normalizePluginConfig(config);
  if (!normalizedConfig.selfCheck.enabled) return { skipped: true, reason: "self-check disabled" };
  const statePath = resolve(resolvePath(root, normalizedConfig.memoryDir), "self-check/state.json");
  const state = readJson(statePath, { version: 1 });
  const lastRunMs = Date.parse(state.lastRunAt ?? "");
  const intervalMs = normalizedConfig.selfCheck.intervalHours * 60 * 60 * 1000;
  if (!force && Number.isFinite(lastRunMs) && now.getTime() - lastRunMs < intervalMs) {
    return { skipped: true, reason: "not due", nextRunAt: new Date(lastRunMs + intervalMs).toISOString() };
  }
  const report = {
    version: 1,
    startedAt: now.toISOString(),
    catchup: await runDiscordCatchup({ root, config: normalizedConfig, openclawConfig, logger, now })
  };
  report.drift = runDriftAudit({ root, config: normalizedConfig, openclawConfig, catchup: report.catchup });
  if (deliverReport) {
    try {
      report.delivery = await sendSelfCheckReportToSetup({ config: normalizedConfig, openclawConfig, report });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.warn?.(`clawclave: self-check report delivery failed: ${message}`);
      report.delivery = { sent: false, error: message };
    }
  } else {
    report.delivery = { sent: false, reason: "delivery disabled" };
  }
  report.finishedAt = new Date().toISOString();
  writeJson(statePath, {
    version: 1,
    lastRunAt: report.finishedAt,
    lastReport: report
  });
  return report;
}

export const runWeeklySelfCheck = runDailySelfCheck;

export function startClawclaveMaintenance({ root, config = {}, openclawConfig = {}, logger }) {
  const normalizedConfig = normalizePluginConfig(config);
  const timers = [];
  const runCatchup = () => {
    runDiscordCatchup({ root, config: normalizedConfig, openclawConfig, logger }).catch((error) => {
      logger?.warn?.(`clawclave: catchup worker failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  };
  const runSelfCheck = () => {
    runDailySelfCheck({ root, config: normalizedConfig, openclawConfig, logger }).catch((error) => {
      logger?.warn?.(`clawclave: self-check worker failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  };
  if (normalizedConfig.catchup.enabled) {
    timers.push(setTimeout(runCatchup, normalizedConfig.catchup.initialDelayMinutes * 60 * 1000));
    timers.push(setInterval(runCatchup, normalizedConfig.catchup.intervalMinutes * 60 * 1000));
  }
  if (normalizedConfig.selfCheck.enabled) {
    timers.push(setTimeout(runSelfCheck, normalizedConfig.selfCheck.initialDelayMinutes * 60 * 1000));
    timers.push(setInterval(runSelfCheck, Math.min(normalizedConfig.selfCheck.intervalHours, 24) * 60 * 60 * 1000));
  }
  return () => {
    for (const timer of timers) clearTimeout(timer);
  };
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

function buildHostedTurnContext({ state, accountId }) {
  if (!isHostedTurnFresh(state)) return "";
  const expected = Array.isArray(state.expectedAgents) ? state.expectedAgents : [];
  const received = Array.isArray(state.receivedAgents) ? state.receivedAgents : [];
  const expectedLines = expected.map((agent) => {
    const marker = received.includes(agent.accountId) ? "received" : "pending";
    return `- ${agent.displayName ?? agent.accountId} (${agent.accountId}): ${marker}`;
  });
  const isHost = accountId === state.hostAccountId;
  const participant = expected.find((agent) => agent.accountId === accountId);
  return [
    `<clawclave_hosted_turn id="${state.id ?? ""}" status="${state.status}" mode="${state.mode ?? ""}">`,
    `Host: ${state.hostAccountId ?? "host"}`,
    `Deadline: ${state.deadlineAt ?? "not set"}`,
    "Expected agents:",
    ...expectedLines,
    isHost
      ? "Host guidance: prefer silence over noise. Summarize only after all expected replies arrive, after expected-1 replies and the minimum wait has passed, or after the deadline. Do not mention agents again unless intentionally opening a new round."
      : participant
        ? "Participant guidance: you were invited by the host agent for this hosted turn. Reply once, stay within your assigned expertise, do not summon other agents, and do not continue the discussion unless the host agent opens another round."
        : "Non-participant guidance: you are not expected in this hosted turn. Stay silent unless directly mentioned by the host agent.",
    "</clawclave_hosted_turn>"
  ].join("\n");
}

function buildHostRosterContext({ root, config, accountId }) {
  if (!config.hostedTurns || accountId !== config.hostAccountId) return "";
  const roles = loadAgentRoleMap(root, config)
    .filter((role) => firstString(role.accountId) && firstString(role.accountId) !== config.hostAccountId)
    .map((role) => {
      const accountId = firstString(role.accountId);
      const displayName = firstString(role.displayName, role.roleName, role.accountId);
      const botUserId = firstString(role.botUserId);
      const roleId = firstString(role.roleId);
      const mention = botUserId ? `<@${botUserId}>` : "";
      const roleMention = roleId ? `<@&${roleId}>` : "";
      return `- ${displayName} (${accountId}): ${mention}${roleMention ? ` / ${roleMention}` : ""}`;
    });
  if (roles.length === 0) return "";
  return [
    "<clawclave_host_roster>",
    "When hosting a discussion, contest, research check, or participation event, invite agents with these exact Discord mentions. Plain @name text is not a ping and does not open hosted state.",
    "If a human directly mentions an agent, that direct mention has priority for that agent. As host, do not repeat direct human pings; stay quiet or coordinate only when the human asked the host agent to host, summarize, route, or reduce noise.",
    "Do not ask the human to mention experts directly. Do not mention participants again in a summary unless intentionally opening a new round.",
    ...roles,
    "</clawclave_host_roster>"
  ].join("\n");
}

function buildUnmappedContext({ ids, onboardingState }) {
  return [
    `<clawclave_unmapped_channel channel_id="${ids.channelId ?? ""}" guild_id="${ids.guildId ?? ""}">`,
    "This Discord channel is not registered in the group goals source of truth.",
    `Onboarding status: ${onboardingState?.status ?? "pending_goal"}`,
    "Pending-goal rule: do not answer normal business, scheduled, research, contest, or expert-routing requests in this channel yet.",
    "If a response is needed, only ask the human to confirm: slug, group name, one-line goal, north star, two operating metrics, and two guardrail metrics.",
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
  const groupText = group
    ? buildMappedContext({ group, ids, tailEvents })
    : buildUnmappedContext({ ids, onboardingState });
  const hostedTurn = readActiveHostedTurn(root, normalizedConfig, ids).state;
  const hostedTurnText = buildHostedTurnContext({
    state: hostedTurn,
    accountId: firstString(ctx.agentId, ctx.agent_id, event.agentId, event.agent_id)
  });
  const accountId = firstString(ctx.agentId, ctx.agent_id, event.agentId, event.agent_id);
  const hostRosterText = buildHostRosterContext({
    root,
    config: normalizedConfig,
    accountId
  });
  const text = [groupText, hostedTurnText, hostRosterText].filter(Boolean).join("\n\n");

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
