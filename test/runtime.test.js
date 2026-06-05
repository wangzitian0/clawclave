import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  appendHookTranscriptEvent,
  buildPromptHookDecision,
  formatSelfCheckReport,
  normalizePluginConfig,
  recordDiscordRawIngress,
  recordOpenClawOutboundResult,
  recordOpenClawOutputIntent,
  resolveDiscordIds,
  runDailySelfCheck,
  runDiscordCatchup,
  runDriftAudit,
  startClawclaveMaintenance
} from "../src/runtime.js";

function tempRoot() {
  return mkdtempSync(resolve(tmpdir(), "clawclave-"));
}

function writeGoals(root) {
  mkdirSync(resolve(root, "workspace/groups"), { recursive: true });
  writeFileSync(
    resolve(root, "workspace/groups/company-goals.json"),
    `${JSON.stringify({
      version: 1,
      groups: [
        {
          slug: "ops",
          name: "Operations",
          channelId: "123",
          oneLineGoal: "Close incidents with evidence.",
          northStar: "Verified closures.",
          operatingMetrics: ["Time to diagnosis.", "Owner assigned."],
          guardrailMetrics: ["Unverified claims.", "Repeated fixes."]
        }
      ]
    }, null, 2)}\n`
  );
}

function writeGroupWorkspace(root) {
  mkdirSync(resolve(root, "workspace/groups/ops"), { recursive: true });
  mkdirSync(resolve(root, "workspace/groups/discussions"), { recursive: true });
  writeFileSync(resolve(root, "workspace/AGENTS.md"), "# Org Rules\n\nKeep replies short.");
  writeFileSync(resolve(root, "workspace/groups/communication-contracts.md"), "# Contracts\n\nEvidence first.");
  writeFileSync(resolve(root, "workspace/groups/interaction-taxonomy.md"), "# Taxonomy\n\nUse the lightest mode.");
  writeFileSync(resolve(root, "workspace/groups/discussions/README.md"), "# Discussions\n\nTrack open work.");
  writeFileSync(resolve(root, "workspace/groups/ops/IDENTITY.md"), "# Ops Identity\n\nClose incidents with evidence.");
  writeFileSync(resolve(root, "workspace/groups/ops/AGENTS.md"), "# Ops Agent Rules\n\nPrefer verified state.");
  writeFileSync(resolve(root, "workspace/groups/ops/MEMORY.md"), "# Ops Memory\n\nDo not repeat unverified fixes.");
  writeFileSync(resolve(root, "workspace/groups/ops/SOUL.md"), "# Ops Soul\n\nCalm and concrete.");
  writeFileSync(resolve(root, "workspace/groups/ops/USER.md"), "# Ops User\n\nThe user wants evidence.");
  writeFileSync(resolve(root, "workspace/groups/ops/HEARTBEAT.md"), "# Ops Heartbeat\n\nReview daily.");
}

function mockJsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: { "content-type": "application/json" }
  });
}

async function withMockFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options, calls.length);
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function openclawConfigForCatchup(channelId = "123") {
  return {
    channels: {
      discord: {
        guilds: {
          "*": {
            channels: {
              [channelId]: {}
            }
          }
        },
        accounts: {
          host: {
            token: "test-token"
          }
        }
      }
    }
  };
}

test("normalizePluginConfig uses marketplace-safe defaults", () => {
  assert.deepEqual(normalizePluginConfig({ tailEvents: 99 }), {
    rootDir: undefined,
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
    tailEvents: 50,
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
  });
});

test("resolveDiscordIds handles channel aliases", () => {
  assert.equal(
    resolveDiscordIds({ metadata: { originatingTo: "channel:123" } }, { channelId: "discord" }).channelId,
    "123"
  );
});

test("buildPromptHookDecision injects mapped group context", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    writeGroupWorkspace(root);
    const result = buildPromptHookDecision({
      root,
      event: {},
      ctx: { messageProvider: "discord", channelId: "123" }
    });
    assert.equal(result.audit.loaded, true);
    assert.equal(result.audit.groupSlug, "ops");
    assert.match(result.decision.appendSystemContext, /clawclave_group_context/);
    assert.match(result.decision.appendSystemContext, /Close incidents with evidence/);
    assert.match(result.decision.appendSystemContext, /<group_file name="MEMORY.md"/);
    assert.match(result.decision.appendSystemContext, /Do not repeat unverified fixes/);
    assert.match(result.decision.appendSystemContext, /<group_shared_file path="workspace\/AGENTS.md"/);
    assert.ok(result.audit.files.some((entry) => entry.file === "MEMORY.md"));
    assert.ok(result.audit.sharedFiles.some((entry) => entry.file === "workspace/AGENTS.md"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildPromptHookDecision injects host roster before hosted state exists", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    mkdirSync(resolve(root, "workspace/agents"), { recursive: true });
    writeFileSync(
      resolve(root, "workspace/agents/discord-agent-roles.json"),
      `${JSON.stringify({
        roles: [
          {
            accountId: "linus",
            displayName: "Linus Torvalds",
            botUserId: "1478055078140182690",
            roleId: "1478057217365250051"
          },
          {
            accountId: "host",
            displayName: "Host Agent",
            botUserId: "1476901813792931994",
            roleId: "1478057919525290159"
          }
        ]
      }, null, 2)}\n`
    );
    const result = buildPromptHookDecision({
      root,
      event: {},
      ctx: { messageProvider: "discord", channelId: "123", agentId: "host" }
    });
    assert.match(result.decision.appendSystemContext, /clawclave_host_roster/);
    assert.match(result.decision.appendSystemContext, /<@1478055078140182690>/);
    assert.match(result.decision.appendSystemContext, /Plain @name text is not a ping/);
    assert.match(result.decision.appendSystemContext, /direct mention has priority/);
    assert.doesNotMatch(result.decision.appendSystemContext, /1476901813792931994/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unmapped Discord channels create onboarding state", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    const result = appendHookTranscriptEvent({
      root,
      event: { content: "hi", messageId: "m1", metadata: { guildId: "g1", originatingTo: "999" } },
      ctx: { channelId: "discord", messageId: "m1" },
      direction: "inbound"
    });
    assert.equal(result.appended, true);
    const statePath = resolve(root, "workspace/groups/onboarding/active/999.json");
    assert.equal(existsSync(statePath), true);
    assert.match(readFileSync(statePath, "utf8"), /pending_goal/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("non-host group inbound hooks skip shared persistence", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    const result = appendHookTranscriptEvent({
      root,
      event: { content: "hi from group", messageId: "m1", metadata: { guildId: "g1", originatingTo: "123" } },
      ctx: { channelId: "discord", agentId: "linus" },
      direction: "inbound"
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, "shared Discord group persistence is owned by host account");
    assert.equal(result.sharedOwner, "host");
    assert.equal(result.accountId, "linus");
    assert.equal(existsSync(resolve(root, "memory/clawclave/transcripts/groups/ops/channels/123")), false);
    assert.equal(existsSync(resolve(root, "memory/discord/raw/guilds/g1/channels/123/events")), false);
    assert.equal(existsSync(resolve(root, "workspace/groups/onboarding/active/123.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("host group inbound hooks own shared persistence", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    const result = appendHookTranscriptEvent({
      root,
      event: { content: "hi from group", messageId: "m1", metadata: { guildId: "g1", originatingTo: "123" } },
      ctx: { channelId: "discord", agentId: "host" },
      direction: "inbound"
    });

    assert.equal(result.appended, true);
    assert.equal(result.skipped, undefined);
    assert.equal(result.groupSlug, "ops");
    assert.equal(existsSync(resolve(root, "memory/clawclave/transcripts/groups/ops/channels/123")), true);
    assert.equal(existsSync(resolve(root, "memory/discord/raw/guilds/g1/channels/123/events")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unmapped prompt context blocks normal business before onboarding", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    const result = buildPromptHookDecision({
      root,
      event: { metadata: { guildId: "g1", originatingTo: "999" } },
      ctx: { channelId: "discord", agentId: "host", messageId: "m1" }
    });
    assert.equal(result.audit.loaded, true);
    assert.equal(result.audit.unmapped, true);
    assert.match(result.decision.appendSystemContext, /clawclave_unmapped_channel/);
    assert.match(result.decision.appendSystemContext, /pending_goal/);
    assert.match(result.decision.appendSystemContext, /do not answer normal business/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("raw ingress creates onboarding state and prompts only from host account", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    const event = {
      id: "raw-1",
      guild_id: "g1",
      channel_id: "999",
      timestamp: "2026-05-20T00:00:00.000Z",
      content: "hi",
      author: { id: "u1", username: "tester" }
    };
    const nonHost = recordDiscordRawIngress({ root, event, accountId: "other" });
    assert.equal(nonHost.handled, true);
    assert.equal(nonHost.skipped, true);
    assert.equal(nonHost.orchestrated, false);
    assert.equal(nonHost.visiblePrompt, undefined);
    assert.equal(nonHost.rawJournal.appended, false);
    assert.equal(existsSync(resolve(root, "memory/discord/raw/guilds/g1/channels/999/events")), false);
    const duplicate = recordDiscordRawIngress({ root, event, accountId: "other" });
    assert.equal(duplicate.skipped, true);
    const host = recordDiscordRawIngress({ root, event: { ...event, id: "raw-2" }, accountId: "host" });
    assert.match(host.visiblePrompt, /这个群还没有初始化目标/);
    assert.equal(host.outputIntent.turnJournal.appended, true);
    assert.match(readFileSync(host.outputIntent.turnJournal.file, "utf8"), /"checkpoint":"openclaw_output"/);
    const delivered = recordDiscordRawIngress({
      root,
      event: {
        ...event,
        id: "bot-1",
        content: host.visiblePrompt,
        author: { id: "bot-1", username: "TianClaws", bot: true }
      },
      accountId: "host"
    });
    assert.equal(delivered.outputDelivery.matched, true);
    assert.equal(delivered.outputDelivery.rawJournal.appended, true);
    assert.match(readFileSync(delivered.outputDelivery.rawJournal.file, "utf8"), /"checkpoint":"discord_output"/);
    assert.match(readFileSync(delivered.outputDelivery.turnJournal.file, "utf8"), /"phase":"output_result"/);
    assert.match(readFileSync(delivered.outputDelivery.turnJournal.file, "utf8"), /"checkpoint":"discord_output"/);
    const again = recordDiscordRawIngress({ root, event: { ...event, id: "raw-3" }, accountId: "host" });
    assert.match(again.visiblePrompt, /等待目标确认/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("direct messages are persisted without group onboarding prompts", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    const event = {
      id: "dm-1",
      channel_id: "1476919184280653915",
      timestamp: "2026-06-03T11:31:25.131Z",
      content: "ping 0603",
      author: { id: "u1", username: "tester" }
    };

    const result = recordDiscordRawIngress({ root, event, accountId: "host" });

    assert.equal(result.handled, true);
    assert.equal(result.orchestrated, false);
    assert.equal(result.reason, "direct message persistence only");
    assert.equal(result.visiblePrompt, undefined);
    assert.equal(result.rawJournal.appended, true);
    assert.equal(result.transcript.appended, true);
    assert.equal(existsSync(resolve(root, "workspace/groups/onboarding/active/1476919184280653915.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("direct message prompt context does not inject unmapped group onboarding", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    const result = buildPromptHookDecision({
      root,
      event: { metadata: { originatingTo: "1476919184280653915" } },
      ctx: { channelId: "discord", agentId: "host", messageId: "dm-1" }
    });

    assert.equal(result.decision, undefined);
    assert.equal(result.audit.loaded, false);
    assert.equal(result.audit.reason, "not a Discord guild channel");
    assert.equal(existsSync(resolve(root, "workspace/groups/onboarding/active/1476919184280653915.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("raw ingress configures pending group from substantive host reply", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    const event = {
      id: "raw-1",
      guild_id: "g1",
      channel_id: "1506560974281248881",
      timestamp: "2026-05-20T00:00:00.000Z",
      content: "hi",
      author: { id: "u1", username: "tester" }
    };
    recordDiscordRawIngress({ root, event, accountId: "host" });
    const configured = recordDiscordRawIngress({
      root,
      event: {
        ...event,
        id: "raw-2",
        content: "一起刷西部世界电视剧\n讨论人工智能和“意识”的本质\n其他的你定吧"
      },
      accountId: "host"
    });
    assert.match(configured.visiblePrompt, /已初始化 Group 248881/);
    const goals = JSON.parse(readFileSync(resolve(root, "workspace/groups/company-goals.json"), "utf8"));
    const group = goals.groups.find((entry) => entry.slug === "group-248881");
    assert.equal(group.channelId, "1506560974281248881");
    assert.match(group.oneLineGoal, /一起刷西部世界电视剧/);
    assert.equal(existsSync(resolve(root, "workspace/groups/group-248881/IDENTITY.md")), true);
    const state = JSON.parse(readFileSync(resolve(root, "workspace/groups/onboarding/active/1506560974281248881.json"), "utf8"));
    assert.equal(state.status, "configured");
    assert.equal(state.groupSlug, "group-248881");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("raw ingress persists Discord channel history without guild id", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    const result = recordDiscordRawIngress({
      root,
      event: {
        id: "history-1",
        channel_id: "123",
        timestamp: "2026-05-20T00:00:00.000Z",
        content: "history message",
        author: { id: "u1", username: "tester" }
      },
      accountId: "host"
    });
    assert.equal(result.handled, true);
    assert.equal(result.rawJournal.appended, true);
    assert.equal(result.transcript.appended, true);
    assert.equal(result.groupSlug, "ops");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("raw ingress tolerates circular Discord raw data", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    const rawData = {
      id: "circular-1",
      channel_id: "123",
      timestamp: "2026-05-20T00:00:00.000Z",
      content: "ping",
      author: { id: "u1", username: "tester" }
    };
    rawData.timeout = { owner: rawData };

    const result = recordDiscordRawIngress({
      root,
      event: { message: { rawData } },
      accountId: "host"
    });

    assert.equal(result.rawJournal.appended, true);
    const raw = readFileSync(result.rawJournal.file, "utf8");
    assert.match(raw, /"content":"ping"/);
    assert.match(raw, /"owner":"\[Circular\]"/);
    assert.equal(existsSync(resolve(root, "workspace/groups/onboarding/active/123.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("raw ingress reminds pending host without letting non-host overwrite state", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    const event = {
      id: "raw-1",
      guild_id: "g1",
      channel_id: "999",
      timestamp: "2026-05-20T00:00:00.000Z",
      content: "hi",
      author: { id: "u1", username: "tester" }
    };
    recordDiscordRawIngress({ root, event, accountId: "host" });
    const reminder = recordDiscordRawIngress({ root, event: { ...event, id: "raw-2" }, accountId: "host" });
    assert.match(reminder.visiblePrompt, /等待目标确认/);
    const nonHost = recordDiscordRawIngress({ root, event: { ...event, id: "raw-3", content: "anything" }, accountId: "linus" });
    assert.equal(nonHost.visiblePrompt, undefined);
    const state = JSON.parse(readFileSync(resolve(root, "workspace/groups/onboarding/active/999.json"), "utf8"));
    assert.equal(state.lastSeenByAccountId, "host");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("transcript writer records normalized outbound events", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    const result = appendHookTranscriptEvent({
      root,
      event: { content: "done", messageId: "m2", metadata: { originatingTo: "123" } },
      ctx: { channelId: "discord", agentId: "host" },
      direction: "outbound"
    });
    assert.equal(result.groupSlug, "ops");
    assert.match(readFileSync(result.file, "utf8"), /"direction":"outbound"/);
    assert.match(readFileSync(result.file, "utf8"), /"agentId":"host"/);
    assert.equal(result.turnJournal.appended, true);
    assert.match(readFileSync(result.turnJournal.file, "utf8"), /"phase":"output_result"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("OpenClaw output intent and outbound result write separate journals", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    const ctx = { messageProvider: "discord", channelId: "discord", agentId: "host" };
    const event = { content: "done", messageId: "m3", metadata: { originatingTo: "123" } };
    const intent = recordOpenClawOutputIntent({ root, event, ctx });
    assert.equal(intent.recorded, true);
    assert.match(intent.file, /memory\/openclaw\/turns\/discord\/accounts\/host\/sessions\/123\/\d{4}-/);
    assert.match(readFileSync(intent.file, "utf8"), /"phase":"output_intent"/);
    assert.match(readFileSync(intent.file, "utf8"), /"checkpoint":"openclaw_output"/);
    const result = recordOpenClawOutboundResult({ root, event, ctx });
    assert.equal(result.recorded, true);
    assert.equal(result.rawJournal.appended, true);
    assert.match(result.rawJournal.file, /memory\/discord\/raw\/outbound\/accounts\/host\/channels\/123\/events\/\d{4}-/);
    assert.match(readFileSync(result.rawJournal.file, "utf8"), /"phase":"sent"/);
    assert.match(readFileSync(result.rawJournal.file, "utf8"), /"checkpoint":"discord_output"/);
    assert.match(result.turnJournal.file, /memory\/openclaw\/turns\/discord\/accounts\/host\/sessions\/123\/\d{4}-/);
    assert.match(readFileSync(result.turnJournal.file, "utf8"), /"phase":"output_result"/);
    assert.match(readFileSync(result.turnJournal.file, "utf8"), /"checkpoint":"discord_output"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("self-check report summarizes catchup and errors", () => {
  const report = formatSelfCheckReport({
    startedAt: "2026-05-26T00:00:00.000Z",
    maintenance: {
      workerId: "worker-1",
      active: true,
      startedAt: "2026-05-26T00:00:00.000Z",
      timers: {
        catchupInterval: { nextRunAt: "2026-05-26T00:10:00.000Z" }
      }
    },
    catchup: {
      lookbackMinutes: 180,
      channels: 2,
      fetched: 3,
      rawAppended: 1,
      transcriptAppended: 1,
      duplicates: 2,
      errors: [{ channelId: "123", message: "missing access" }]
    }
  });
  assert.match(report, /NEEDS_ATTENTION/);
  assert.match(report, /Worker: worker-1 active=true/);
  assert.match(report, /catchupInterval=2026-05-26T00:10:00.000Z/);
  assert.match(report, /Channels scanned: 2/);
  assert.match(report, /123: missing access/);
});

test("startClawclaveMaintenance keeps a single worker and writes state", () => {
  const root = tempRoot();
  try {
    const config = { catchup: { enabled: false }, selfCheck: { enabled: false } };
    const firstStop = startClawclaveMaintenance({ root, config });
    const first = JSON.parse(readFileSync(resolve(root, "memory/clawclave/maintenance/state.json"), "utf8"));
    assert.equal(first.active, true);
    assert.equal(first.stopReason, null);
    const secondStop = startClawclaveMaintenance({ root, config });
    const second = JSON.parse(readFileSync(resolve(root, "memory/clawclave/maintenance/state.json"), "utf8"));
    assert.equal(second.active, true);
    assert.notEqual(second.workerId, first.workerId);
    secondStop("test-stop");
    const stopped = JSON.parse(readFileSync(resolve(root, "memory/clawclave/maintenance/state.json"), "utf8"));
    assert.equal(stopped.active, false);
    assert.equal(stopped.stopReason, "test-stop");
    firstStop("late-old-stop");
    const afterLateOldStop = JSON.parse(readFileSync(resolve(root, "memory/clawclave/maintenance/state.json"), "utf8"));
    assert.equal(afterLateOldStop.workerId, second.workerId);
    assert.equal(afterLateOldStop.stopReason, "test-stop");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runDiscordCatchup backfills recent Discord history and skips old messages", async () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    const now = new Date("2026-05-26T08:00:00.000Z");
    await withMockFetch((url, options) => {
      assert.equal(options.headers.Authorization, "Bot test-token");
      if (url.includes("/channels/123/messages?")) {
        return mockJsonResponse([
          {
            id: "recent-2",
            channel_id: "123",
            timestamp: "2026-05-26T07:59:00.000Z",
            content: "second",
            author: { id: "u2", username: "two" }
          },
          {
            id: "recent-1",
            channel_id: "123",
            timestamp: "2026-05-26T07:58:00.000Z",
            content: "first",
            author: { id: "u1", username: "one" }
          },
          {
            id: "old-1",
            channel_id: "123",
            timestamp: "2026-05-26T04:00:00.000Z",
            content: "old",
            author: { id: "u3", username: "old" }
          }
        ]);
      }
      throw new Error(`unexpected URL ${url}`);
    }, async (calls) => {
      const summary = await runDiscordCatchup({
        root,
        openclawConfig: openclawConfigForCatchup("123"),
        config: {
          hostAccountId: "host",
          selfCheck: { setupChannelId: "123" },
          catchup: { lookbackMinutes: 180, maxPagesPerChannel: 3 }
        },
        now
      });
      assert.equal(calls.length, 1);
      assert.equal(summary.channels, 1);
      assert.equal(summary.fetched, 2);
      assert.equal(summary.rawAppended, 2);
      assert.equal(summary.transcriptAppended, 2);
      assert.equal(summary.errors.length, 0);
      const state = JSON.parse(readFileSync(resolve(root, "memory/clawclave/catchup/state.json"), "utf8"));
      assert.equal(state.lastRun.fetched, 2);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runDiscordCatchup is persistence-only and does not open onboarding state", async () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    await withMockFetch((url) => {
      if (url.includes("/channels/999/messages?")) {
        return mockJsonResponse([
          {
            id: "unmapped-1",
            channel_id: "999",
            timestamp: "2026-05-26T07:59:00.000Z",
            content: "new channel topic",
            author: { id: "u1", username: "one" }
          }
        ]);
      }
      throw new Error(`unexpected URL ${url}`);
    }, async () => {
      const summary = await runDiscordCatchup({
        root,
        openclawConfig: openclawConfigForCatchup("999"),
        config: {
          hostAccountId: "host",
          selfCheck: { setupChannelId: "123" },
          catchup: { lookbackMinutes: 180, maxPagesPerChannel: 1 }
        },
        now: new Date("2026-05-26T08:00:00.000Z")
      });
      assert.equal(summary.fetched, 1);
      assert.equal(summary.rawAppended, 1);
      assert.equal(summary.transcriptAppended, 1);
      assert.equal(existsSync(resolve(root, "workspace/groups/onboarding/active/999.json")), false);
      assert.equal(existsSync(resolve(root, "workspace/groups/discussions/active/999.json")), false);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runDiscordCatchup reports channel errors without aborting all channels", async () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    const openclawConfig = {
      channels: {
        discord: {
          guilds: {
            "*": {
              channels: {
                "123": {},
                "456": {}
              }
            }
          },
          accounts: {
            host: { token: "Bot already-prefixed" }
          }
        }
      }
    };
    const warnings = [];
    await withMockFetch((url, options) => {
      assert.equal(options.headers.Authorization, "Bot already-prefixed");
      if (url.includes("/channels/123/messages?")) {
        return mockJsonResponse([
          {
            id: "ok-1",
            channel_id: "123",
            timestamp: "2026-05-26T07:59:00.000Z",
            content: "ok",
            author: { id: "u1", username: "one" }
          }
        ]);
      }
      if (url.includes("/channels/456/messages?")) {
        return mockJsonResponse({ message: "Missing Access" }, { status: 403, statusText: "Forbidden" });
      }
      throw new Error(`unexpected URL ${url}`);
    }, async () => {
      const summary = await runDiscordCatchup({
        root,
        openclawConfig,
        config: {
          hostAccountId: "host",
          selfCheck: { setupChannelId: "123" },
          catchup: { lookbackMinutes: 180, maxPagesPerChannel: 1 }
        },
        logger: { warn: (message) => warnings.push(message) },
        now: new Date("2026-05-26T08:00:00.000Z")
      });
      assert.equal(summary.channels, 2);
      assert.equal(summary.fetched, 1);
      assert.equal(summary.rawAppended, 1);
      assert.equal(summary.errors.length, 1);
      assert.equal(summary.errors[0].channelId, "456");
      assert.match(summary.errors[0].message, /Discord API 403/);
      assert.equal(warnings.length, 1);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runDiscordCatchup scans drift-discovered channels from goals and onboarding", async () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    mkdirSync(resolve(root, "workspace/groups/onboarding/active"), { recursive: true });
    writeFileSync(
      resolve(root, "workspace/groups/onboarding/active/456.json"),
      `${JSON.stringify({ version: 1, channelId: "456", firstMessageId: "m456", status: "pending_goal" }, null, 2)}\n`
    );
    const fetchedChannels = [];
    await withMockFetch((url) => {
      const match = url.match(/\/channels\/(\d+)\/messages\?/);
      if (!match) throw new Error(`unexpected URL ${url}`);
      fetchedChannels.push(match[1]);
      return mockJsonResponse([]);
    }, async () => {
      const summary = await runDiscordCatchup({
        root,
        openclawConfig: {
          channels: { discord: { accounts: { host: { token: "test-token" } } } }
        },
        config: {
          hostAccountId: "host",
          selfCheck: { setupChannelId: "789" },
          catchup: { lookbackMinutes: 180, maxPagesPerChannel: 1 }
        },
        now: new Date("2026-05-26T08:00:00.000Z")
      });
      assert.deepEqual(fetchedChannels.sort(), ["123", "456", "789"]);
      assert.equal(summary.channels, 3);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runDiscordCatchup can be disabled", async () => {
  const root = tempRoot();
  try {
    const result = await runDiscordCatchup({
      root,
      config: { catchup: { enabled: false } },
      openclawConfig: openclawConfigForCatchup("123")
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "catchup disabled");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runDailySelfCheck skips when the previous report is still fresh", async () => {
  const root = tempRoot();
  try {
    mkdirSync(resolve(root, "memory/clawclave/self-check"), { recursive: true });
    writeFileSync(
      resolve(root, "memory/clawclave/self-check/state.json"),
      `${JSON.stringify({ version: 1, lastRunAt: "2026-05-26T07:00:00.000Z" }, null, 2)}\n`
    );
    const result = await runDailySelfCheck({
      root,
      config: { selfCheck: { intervalHours: 24 } },
      openclawConfig: openclawConfigForCatchup("123"),
      now: new Date("2026-05-26T08:00:00.000Z")
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "not due");
    assert.equal(result.nextRunAt, "2026-05-27T07:00:00.000Z");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runDailySelfCheck creates setup thread and posts daily drift report", async () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    const posted = [];
    await withMockFetch((url, options) => {
      if (url.endsWith("/channels/123/messages?limit=100")) {
        return mockJsonResponse([]);
      }
      if (url.endsWith("/channels/setup/messages?limit=100")) {
        return mockJsonResponse([]);
      }
      if (url.endsWith("/channels/setup")) {
        return mockJsonResponse({ id: "setup", guild_id: "guild-1" });
      }
      if (url.endsWith("/guilds/guild-1/threads/active")) {
        return mockJsonResponse({ threads: [] });
      }
      if (url.endsWith("/channels/setup/threads/archived/public?limit=100")) {
        return mockJsonResponse({ threads: [] });
      }
      if (url.endsWith("/channels/setup/threads")) {
        assert.equal(options.method, "POST");
        const body = JSON.parse(options.body);
        assert.equal(body.name, "Daily Audit");
        return mockJsonResponse({ id: "thread-1" });
      }
      if (url.endsWith("/channels/thread-1/messages")) {
        assert.equal(options.method, "POST");
        posted.push(JSON.parse(options.body));
        return mockJsonResponse({ id: "posted-1" });
      }
      throw new Error(`unexpected URL ${url}`);
    }, async () => {
      const report = await runDailySelfCheck({
        root,
        config: {
          hostAccountId: "host",
          selfCheck: { setupChannelId: "setup", threadName: "Daily Audit" },
          catchup: { lookbackMinutes: 180, maxPagesPerChannel: 1 }
        },
        openclawConfig: openclawConfigForCatchup("123"),
        force: true,
        now: new Date("2026-05-26T08:00:00.000Z")
      });
      assert.deepEqual(report.delivery, { sent: true, threadId: "thread-1" });
      assert.equal(report.drift.status, "WARN");
      assert.equal(posted.length, 1);
      assert.match(posted[0].content, /Clawclave daily persistence audit/);
      assert.match(posted[0].content, /Drift status: WARN/);
      const state = JSON.parse(readFileSync(resolve(root, "memory/clawclave/self-check/state.json"), "utf8"));
      assert.equal(state.lastReport.delivery.threadId, "thread-1");
      assert.equal(state.lastReport.drift.sources.catchupTargets, 1);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runDailySelfCheck can run as a dry-run without Discord delivery", async () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    let fetchCalls = 0;
    await withMockFetch((url) => {
      fetchCalls += 1;
      if (url.endsWith("/channels/123/messages?limit=100")) return mockJsonResponse([]);
      throw new Error(`unexpected URL ${url}`);
    }, async () => {
      const report = await runDailySelfCheck({
        root,
        config: {
          hostAccountId: "host",
          selfCheck: { setupChannelId: "setup", threadName: "Daily Audit" },
          catchup: { lookbackMinutes: 180, maxPagesPerChannel: 1 }
        },
        openclawConfig: openclawConfigForCatchup("123"),
        force: true,
        deliverReport: false,
        now: new Date("2026-05-26T08:00:00.000Z")
      });
      assert.equal(fetchCalls, 1);
      assert.deepEqual(report.delivery, { sent: false, reason: "delivery disabled" });
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runDriftAudit reports key-path and catchup target drift without model calls", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    mkdirSync(resolve(root, "workspace/groups/onboarding/active"), { recursive: true });
    writeFileSync(
      resolve(root, "workspace/groups/onboarding/active/456.json"),
      `${JSON.stringify({ channelId: "456", firstMessageId: "m456", status: "pending_goal" }, null, 2)}\n`
    );
    writeFileSync(
      resolve(root, "workspace/groups/onboarding/active/1476887475770228827.json"),
      `${JSON.stringify({ channelId: "1476887475770228827", status: "pending_goal" }, null, 2)}\n`
    );
    mkdirSync(resolve(root, "memory/clawclave/transcripts/channels/1476887475770228827"), { recursive: true });
    writeFileSync(resolve(root, "memory/clawclave/transcripts/channels/1476887475770228827/2026-05.jsonl"), "{}\n");
    mkdirSync(resolve(root, "memory/discord/raw/guilds/1/channels/321/events"), { recursive: true });
    writeFileSync(resolve(root, "memory/discord/raw/guilds/1/channels/321/events/2026-05.jsonl"), "{}\n");
    const report = runDriftAudit({
      root,
      config: { selfCheck: { setupChannelId: "789" } },
      openclawConfig: { channels: { discord: { accounts: { host: { token: "test-token" } } } } }
    });
    assert.equal(report.status, "WARN");
    assert.equal(report.sources.goalChannels, 1);
    assert.equal(report.sources.onboardingChannels, 1);
    assert.equal(report.sources.memoryChannels, 1);
    assert.equal(report.sources.catchupTargets, 4);
    assert.equal(report.sources.canonicalDiscordRawPath, "memory/discord/raw/**");
    assert.equal(report.sources.canonicalOpenClawTurnPath, "memory/openclaw/turns/**");
    assert.equal(report.sources.legacyEvidenceMirrors.discordRawJsonl, 0);
    assert.ok(report.issues.some((issue) => issue.code === "channels_discovered_outside_config"));
    assert.equal(report.discoveredOutsideConfig.includes("1476887475770228827"), false);
    assert.deepEqual(report.checkpointContract.map((item) => item.checkpoint), [
      "discord_input",
      "openclaw_input",
      "openclaw_output",
      "discord_output"
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("host outbound expert mentions create hosted turn state", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    mkdirSync(resolve(root, "workspace/agents"), { recursive: true });
    writeFileSync(
      resolve(root, "workspace/agents/discord-agent-roles.json"),
      `${JSON.stringify({
        roles: [
          {
            accountId: "linus",
            displayName: "Linus Torvalds",
            botUserId: "1478055078140182690",
            roleId: "1478057217365250051"
          },
          {
            accountId: "host",
            displayName: "Host Agent",
            botUserId: "bot-host",
            roleId: "role-host"
          }
        ]
      }, null, 2)}\n`
    );
    const result = appendHookTranscriptEvent({
      root,
      event: { content: "本轮请 <@1478055078140182690> 看一下技术风险，回复一次。", messageId: "m-host", metadata: { originatingTo: "123" } },
      ctx: { channelId: "discord", agentId: "host" },
      direction: "outbound"
    });
    assert.equal(result.hostedTurn.opened, true);
    const statePath = resolve(root, "workspace/groups/discussions/active/123.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.status, "open");
    assert.equal(state.host, "host");
    assert.deepEqual(state.participants.map((agent) => [agent.accountId, agent.status]), [["linus", "pending"]]);
    assert.deepEqual(state.expectedAgents.map((agent) => agent.accountId), ["linus"]);
    assert.equal(state.policy, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("expected bot inbound reply is recorded against hosted turn", () => {
  const root = tempRoot();
  try {
    writeGoals(root);
    mkdirSync(resolve(root, "workspace/agents"), { recursive: true });
    writeFileSync(
      resolve(root, "workspace/agents/discord-agent-roles.json"),
      `${JSON.stringify({
        roles: [
          {
            accountId: "linus",
            displayName: "Linus Torvalds",
            botUserId: "1478055078140182690",
            roleId: "1478057217365250051"
          }
        ]
      }, null, 2)}\n`
    );
    appendHookTranscriptEvent({
      root,
      event: { content: "本轮请 <@1478055078140182690> 回复一次。", messageId: "m-host", metadata: { originatingTo: "123" } },
      ctx: { channelId: "discord", agentId: "host" },
      direction: "outbound"
    });
    const result = appendHookTranscriptEvent({
      root,
      event: {
        content: "技术风险是并发状态不一致。",
        messageId: "m-linus",
        authorId: "1478055078140182690",
        metadata: { originatingTo: "123" }
      },
      ctx: { channelId: "discord" },
      direction: "inbound"
    });
    assert.equal(result.hostedTurn.updated, true);
    const state = JSON.parse(readFileSync(resolve(root, "workspace/groups/discussions/active/123.json"), "utf8"));
    assert.deepEqual(state.receivedAgents, ["linus"]);
    assert.deepEqual(state.participants.map((agent) => [agent.accountId, agent.status]), [["linus", "replied"]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
