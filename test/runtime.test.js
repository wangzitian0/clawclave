import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  appendHookTranscriptEvent,
  buildPromptHookDecision,
  normalizePluginConfig,
  recordDiscordRawIngress,
  resolveDiscordIds
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

test("normalizePluginConfig uses marketplace-safe defaults", () => {
  assert.deepEqual(normalizePluginConfig({ tailEvents: 99 }), {
    rootDir: undefined,
    goalsFile: "workspace/groups/company-goals.json",
    memoryDir: "memory/clawclave",
    onboardingDir: "workspace/groups/onboarding/active",
    hostAccountId: "tianclaw",
    promptContext: true,
    transcriptWriter: true,
    onboarding: true,
    tailEvents: 50
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
    const result = buildPromptHookDecision({
      root,
      event: {},
      ctx: { messageProvider: "discord", channelId: "123" }
    });
    assert.equal(result.audit.loaded, true);
    assert.equal(result.audit.groupSlug, "ops");
    assert.match(result.decision.appendSystemContext, /clawclave_group_context/);
    assert.match(result.decision.appendSystemContext, /Close incidents with evidence/);
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
    assert.equal(nonHost.visiblePrompt, undefined);
    const host = recordDiscordRawIngress({ root, event: { ...event, id: "raw-2" }, accountId: "tianclaw" });
    assert.match(host.visiblePrompt, /这个群还没有初始化目标/);
    const again = recordDiscordRawIngress({ root, event: { ...event, id: "raw-3" }, accountId: "tianclaw" });
    assert.equal(again.visiblePrompt, undefined);
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
