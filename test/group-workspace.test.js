import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  appendDiscordMemoryEvent,
  appendDiscordMessageEvent,
  appendGroupSessionEvent,
  auditDiscordMemory,
  auditGroupTranscripts,
  buildGroupContext,
  buildGroupPromptContext,
  buildSharedGroupContext,
  ensureAllGroupWorkspaces,
  loadGoals,
  makeTempRoot,
  normalizeDiscordMessageEvent,
  removeTempRoot,
  resolveGroup,
  resolveGroupFromContext,
  sanitizeForGroupSession,
  validateGroupWorkspaces
} from "../src/group-workspace.js";
import { onboardGroup } from "../src/onboard-discord-group.js";

function writeFixture(root) {
  mkdirSync(resolve(root, "workspace/groups/example"), { recursive: true });
  writeFileSync(
    resolve(root, "workspace/groups/company-goals.json"),
    `${JSON.stringify(
      {
        version: 1,
        review: {
          cadenceDays: 14,
          owner: "tianclaw",
          statsPath: "workspace/groups/reviews/",
          template: "workspace/groups/reviews/TEMPLATE.md"
        },
        groups: [
          {
            slug: "example",
            name: "Example Desk",
            channelId: "123",
            doc: "workspace/groups/example/IDENTITY.md",
            oneLineGoal: "Make the example clear.",
            northStar: "Clear example count.",
            operatingMetrics: ["Specificity rate.", "Closure rate."],
            guardrailMetrics: ["Vague replies.", "Missing owner."]
          }
        ]
      },
      null,
      2
    )}\n`
  );
  writeFileSync(
    resolve(root, "workspace/groups/example/IDENTITY.md"),
    [
      "# example",
      "",
      "- **Discord channel ID:** `123`",
      "- **One-line goal:** Make the example clear.",
      "- **North Star:** Clear example count.",
      "- **Operating metrics:** Specificity rate. Closure rate.",
      "- **Guardrail metrics:** Vague replies. Missing owner."
    ].join("\n")
  );
}

function writeSharedContextFixture(root) {
  mkdirSync(resolve(root, "workspace"), { recursive: true });
  mkdirSync(resolve(root, "workspace/groups/discussions"), { recursive: true });
  writeFileSync(resolve(root, "workspace/AGENTS.md"), "# Organization Rules\n\nDo not expose internal state.");
  writeFileSync(
    resolve(root, "workspace/groups/communication-contracts.md"),
    "# Communication Contracts\n\nParticipation Event\n\nHosted Discussion\n\nResearch / Evidence Work"
  );
  writeFileSync(resolve(root, "workspace/groups/interaction-taxonomy.md"), "# Taxonomy\n\nContest routing rule.");
  writeFileSync(resolve(root, "workspace/groups/discussions/README.md"), "# Discussion State\n\nTrack state.");
}

test("ensure and validate group workspace", () => {
  const root = makeTempRoot();
  try {
    writeFixture(root);
    const created = ensureAllGroupWorkspaces(root);
    assert.ok(created.some((path) => path.endsWith("SOUL.md")));
    assert.deepEqual(validateGroupWorkspaces(root), []);
  } finally {
    removeTempRoot(root);
  }
});

test("buildGroupContext includes wrapper and file hashes", () => {
  const root = makeTempRoot();
  try {
    writeFixture(root);
    ensureAllGroupWorkspaces(root);
    const goals = loadGoals(root);
    const group = resolveGroup(goals, { channelId: "123" });
    const context = buildGroupContext(root, group);
    assert.match(context.text, /<group_context slug="example" channel_id="123">/);
    assert.match(context.text, /<group_file name="IDENTITY.md" sha256="[a-f0-9]{64}">/);
    assert.ok(context.loaded.some((entry) => entry.file === "MEMORY.md"));
  } finally {
    removeTempRoot(root);
  }
});

test("buildSharedGroupContext includes repo-owned shared group rules", () => {
  const root = makeTempRoot();
  try {
    writeFixture(root);
    writeSharedContextFixture(root);
    const context = buildSharedGroupContext(root);
    assert.match(context.text, /<group_shared_file path="workspace\/AGENTS.md"/);
    assert.match(context.text, /workspace\/groups\/communication-contracts.md/);
    assert.match(context.text, /<group_shared_file path="workspace\/groups\/interaction-taxonomy.md"/);
    assert.doesNotMatch(context.text, /joke-contest-template/);
    assert.doesNotMatch(context.text, /contest_state/);
    assert.ok(context.loaded.some((entry) => entry.file === "workspace/groups/discussions/README.md"));
  } finally {
    removeTempRoot(root);
  }
});

test("appendGroupSessionEvent writes parseable JSONL and session index", () => {
  const root = makeTempRoot();
  try {
    writeFixture(root);
    ensureAllGroupWorkspaces(root);
    const group = resolveGroup(loadGoals(root), { slug: "example" });
    const result = appendGroupSessionEvent(root, group, {
      type: "message",
      messageId: "m1",
      authorType: "human",
      content: [{ type: "text", text: "hello" }]
    });
    const lines = readFileSync(result.sessionFile, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).type, "session");
    assert.equal(JSON.parse(lines[1]).type, "message");

    const sessions = JSON.parse(
      readFileSync(resolve(root, "workspace/groups/example/sessions/sessions.json"), "utf8")
    );
    assert.equal(sessions[result.sessionKey].sessionId, result.sessionId);
  } finally {
    removeTempRoot(root);
  }
});

test("appendGroupSessionEvent skips duplicate messageId and direction", () => {
  const root = makeTempRoot();
  try {
    writeFixture(root);
    ensureAllGroupWorkspaces(root);
    const group = resolveGroup(loadGoals(root), { slug: "example" });
    const first = appendGroupSessionEvent(root, group, {
      type: "message",
      messageId: "m1",
      direction: "inbound",
      content: [{ type: "text", text: "hello" }]
    });
    const second = appendGroupSessionEvent(root, group, {
      type: "message",
      messageId: "m1",
      direction: "inbound",
      content: [{ type: "text", text: "hello again" }]
    });
    const lines = readFileSync(first.sessionFile, "utf8").trim().split("\n");
    assert.equal(second.duplicate, true);
    assert.equal(lines.length, 2);
  } finally {
    removeTempRoot(root);
  }
});

test("resolveGroupFromContext supports direct channels and thread parent channels", () => {
  const root = makeTempRoot();
  try {
    writeFixture(root);
    const goals = loadGoals(root);

    const direct = resolveGroupFromContext(goals, { channelId: "123" });
    assert.equal(direct.group.slug, "example");
    assert.equal(direct.resolvedBy, "channelId");

    const thread = resolveGroupFromContext(goals, {
      channelId: "thread-456",
      threadId: "thread-456",
      parentChannelId: "123"
    });
    assert.equal(thread.group.slug, "example");
    assert.equal(thread.channelId, "123");
    assert.equal(thread.resolvedBy, "parentChannelId");
    assert.equal(thread.isThread, true);

    const prefixed = resolveGroupFromContext(goals, {
      channelId: "channel:thread-456",
      threadId: "channel:thread-456",
      parentChannelId: "channel:123"
    });
    assert.equal(prefixed.group.slug, "example");
    assert.equal(prefixed.channelId, "123");
  } finally {
    removeTempRoot(root);
  }
});

test("buildGroupPromptContext includes audit metadata and limited transcript tail", () => {
  const root = makeTempRoot();
  try {
    writeFixture(root);
    writeSharedContextFixture(root);
    ensureAllGroupWorkspaces(root);
    const goals = loadGoals(root);
    const group = resolveGroup(goals, { slug: "example" });
    appendGroupSessionEvent(root, group, {
      type: "message",
      messageId: "m1",
      authorType: "human",
      content: [{ type: "text", text: "first" }]
    });
    appendGroupSessionEvent(root, group, {
      type: "message",
      messageId: "m2",
      authorType: "agent",
      content: [{ type: "text", text: "second" }]
    });

    const result = buildGroupPromptContext(root, { channelId: "123" }, { tailEvents: 1 });
    assert.equal(result.audit.loaded, true);
    assert.equal(result.audit.groupSlug, "example");
    assert.ok(result.audit.sharedFiles.some((entry) => entry.file === "workspace/AGENTS.md"));
    assert.ok(result.audit.sharedFiles.some((entry) => entry.file === "workspace/groups/communication-contracts.md"));
    assert.equal(result.audit.transcriptTail.events, 1);
    assert.match(result.text, /<group_context slug="example" channel_id="123">/);
    assert.match(result.text, /<group_shared_file path="workspace\/AGENTS.md"/);
    assert.doesNotMatch(result.text, /joke-contest-template/);
    assert.doesNotMatch(result.text, /contest_state/);
    assert.match(result.text, /<group_transcript_tail /);
    assert.doesNotMatch(result.text, /"messageId":"m1"/);
    assert.doesNotMatch(result.text, /"text":"first"/);
    assert.match(result.text, /"messageId":"m2"/);
    assert.match(result.text, /"text":"second"/);
  } finally {
    removeTempRoot(root);
  }
});

test("buildGroupPromptContext loads shared fallback for unmapped Discord channels", () => {
  const root = makeTempRoot();
  try {
    writeFixture(root);
    writeSharedContextFixture(root);
    const result = buildGroupPromptContext(root, { channelId: "999" }, { tailEvents: 0 });
    assert.equal(result.audit.loaded, true);
    assert.equal(result.audit.unmapped, true);
    assert.equal(result.audit.channelId, "999");
    assert.match(result.text, /<group_context_unmapped channel_id="999"/);
    assert.match(result.text, /workspace\/groups\/communication-contracts.md/);
    assert.doesNotMatch(result.text, /<group_context slug=/);
  } finally {
    removeTempRoot(root);
  }
});

test("onboardGroup creates goals entry and group workspace", () => {
  const root = makeTempRoot();
  try {
    writeFixture(root);
    ensureAllGroupWorkspaces(root);
    const result = onboardGroup(root, {
      slug: "westworld",
      name: "Westworld Desk",
      channelId: "999123456789",
      oneLineGoal: "Discuss Westworld ideas with clear context.",
      northStar: "Useful Westworld discussion outcomes.",
      op: ["Relevant theory rate.", "Follow-up ideas captured."],
      guardrail: ["Invented canon.", "Unclear spoilers."],
      syncOpenclaw: false,
      writeTopic: false
    });
    assert.equal(result.group.slug, "westworld");
    const goals = JSON.parse(readFileSync(resolve(root, "workspace/groups/company-goals.json"), "utf8"));
    assert.ok(goals.groups.some((group) => group.slug === "westworld"));
    const identity = readFileSync(resolve(root, "workspace/groups/westworld/IDENTITY.md"), "utf8");
    assert.match(identity, /999123456789/);
    assert.match(identity, /Discuss Westworld ideas/);
    assert.deepEqual(validateGroupWorkspaces(root), []);
  } finally {
    removeTempRoot(root);
  }
});

test("buildGroupPromptContext tolerates malformed transcript lines", () => {
  const root = makeTempRoot();
  try {
    writeFixture(root);
    ensureAllGroupWorkspaces(root);
    const goals = loadGoals(root);
    const group = resolveGroup(goals, { slug: "example" });
    const write = appendGroupSessionEvent(root, group, {
      type: "message",
      messageId: "m1",
      authorType: "human",
      content: [{ type: "text", text: "still readable" }]
    });
    appendFileSync(write.sessionFile, "{broken-json\n");

    const result = buildGroupPromptContext(root, { channelId: "123" }, { tailEvents: 3 });
    assert.equal(result.audit.loaded, true);
    assert.equal(result.audit.transcriptTail.invalidLines, 1);
    assert.match(result.text, /still readable/);
  } finally {
    removeTempRoot(root);
  }
});

test("normalize and append Discord messages redact likely secrets", () => {
  const root = makeTempRoot();
  try {
    writeFixture(root);
    ensureAllGroupWorkspaces(root);
    const goals = loadGoals(root);
    const event = normalizeDiscordMessageEvent({
      id: "m1",
      guildId: "g1",
      channelId: "channel:123",
      parentChannelId: "channel-999",
      threadId: "channel:456",
      author: { id: "u1", username: "human" },
      content: "hello Bearer abcdefghijklmnopqrstuvwxyz012345",
      mentions: [{ id: "u2" }],
      attachments: [{ id: "a1", filename: "note.txt", token: "secret" }]
    });

    assert.equal(event.type, "message");
    assert.equal(event.messageId, "m1");
    assert.equal(event.channelId, "123");
    assert.equal(event.parentChannelId, "999");
    assert.equal(event.threadId, "456");
    assert.equal(event.authorType, "human");
    assert.deepEqual(event.mentions, ["u2"]);
    assert.equal(event.content[0].text, "hello [REDACTED_SECRET]");
    assert.equal(event.attachments[0].token, undefined);

    const result = appendDiscordMessageEvent(root, goals, {
      messageId: "m2",
      channelId: "123",
      direction: "inbound",
      authorId: "bot1",
      authorType: "bot",
      content: "github_pat_0123456789abcdefTOKENVALUE"
    });
    assert.equal(result.appended, true);
    assert.equal(result.memoryAppended, true);
    assert.equal(result.ledgerAppended, true);
    assert.match(result.memoryFile, /memory\/discord\/groups\/example\/channels\/123\/events\/\d{4}-\d{2}\.jsonl$/);
    assert.match(result.ledgerFile, /memory\/discord\/ledger\/groups\/example\/channels\/123\/\d{4}-\d{2}\.md$/);
    const body = readFileSync(result.sessionFile, "utf8");
    assert.match(body, /\[REDACTED_SECRET\]/);
    assert.doesNotMatch(body, /github_pat_0123456789abcdefTOKENVALUE/);
    const ledgerBody = readFileSync(result.ledgerFile, "utf8");
    assert.match(ledgerBody, /# Discord Group Channel Transcript example\/123/);
    assert.match(ledgerBody, /message m2/);
    assert.match(ledgerBody, /\[REDACTED_SECRET\]/);
    const memoryBody = readFileSync(result.memoryFile, "utf8");
    assert.match(memoryBody, /"conversationKind":"guild_channel"/);
    assert.match(memoryBody, /\[REDACTED_SECRET\]/);
  } finally {
    removeTempRoot(root);
  }
});

test("append Discord messages writes markdown ledger for unmapped Discord channels", () => {
  const root = makeTempRoot();
  try {
    writeFixture(root);
    ensureAllGroupWorkspaces(root);
    const goals = loadGoals(root);
    const result = appendDiscordMessageEvent(root, goals, {
      messageId: "m-unmapped",
      guildId: "guild-1",
      channelId: "999",
      direction: "inbound",
      authorId: "u1",
      authorLabel: "Human",
      content: "unmapped channel body",
      timestamp: "2026-05-18T08:00:00Z"
    });

    assert.equal(result.appended, true);
    assert.equal(result.reason, "recorded Discord memory without group transcript");
    assert.equal(result.memoryAppended, true);
    assert.equal(result.ledgerAppended, true);
    assert.match(result.memoryFile, /memory\/discord\/guilds\/guild-1\/channels\/999\/events\/2026-05\.jsonl$/);
    assert.match(result.ledgerFile, /memory\/discord\/ledger\/guilds\/guild-1\/channels\/999\/2026-05\.md$/);
    const memoryBody = readFileSync(result.memoryFile, "utf8");
    assert.match(memoryBody, /"conversationKind":"guild_channel"/);
    assert.match(memoryBody, /unmapped channel body/);
    assert.match(readFileSync(result.memoryManifest, "utf8"), /"conversationKind": "guild_channel"/);
    const body = readFileSync(result.ledgerFile, "utf8");
    assert.match(body, /Discord Channel Transcript 999/);
    assert.match(body, /unmapped channel body/);

    const duplicate = appendDiscordMessageEvent(root, goals, {
      messageId: "m-unmapped",
      guildId: "guild-1",
      channelId: "999",
      direction: "inbound",
      authorId: "u1",
      content: "unmapped channel body"
    });
    assert.equal(duplicate.appended, false);
    assert.equal(duplicate.memoryDuplicate, true);
    assert.equal(duplicate.ledgerDuplicate, true);
  } finally {
    removeTempRoot(root);
  }
});

test("append Discord messages writes thread markdown ledgers separately", () => {
  const root = makeTempRoot();
  try {
    writeFixture(root);
    ensureAllGroupWorkspaces(root);
    const goals = loadGoals(root);
    const result = appendDiscordMessageEvent(root, goals, {
      messageId: "m-thread",
      guildId: "guild-1",
      channelId: "123",
      threadId: "thread-1",
      direction: "inbound",
      authorId: "u1",
      content: "thread body",
      timestamp: "2026-05-18T08:00:00Z"
    });

    assert.equal(result.appended, true);
    assert.equal(result.groupSlug, "example");
    assert.equal(result.event.threadId, "thread-1");
    assert.equal(result.conversationKind, "thread");
    assert.match(result.memoryFile, /memory\/discord\/guilds\/guild-1\/channels\/123\/threads\/thread-1\/events\/2026-05\.jsonl$/);
    assert.match(result.ledgerFile, /memory\/discord\/ledger\/guilds\/guild-1\/channels\/123\/threads\/thread-1\/2026-05\.md$/);
    assert.match(readFileSync(result.ledgerFile, "utf8"), /Thread ID: thread-1/);
  } finally {
    removeTempRoot(root);
  }
});

test("append Discord messages classifies forum threads and DMs in memory", () => {
  const root = makeTempRoot();
  try {
    writeFixture(root);
    ensureAllGroupWorkspaces(root);
    const goals = loadGoals(root);
    const forum = appendDiscordMessageEvent(root, goals, {
      messageId: "m-forum",
      guildId: "guild-1",
      channelId: "123",
      threadId: "forum-post-1",
      parentChannelType: "GUILD_FORUM",
      direction: "inbound",
      authorId: "u1",
      content: "forum post body",
      timestamp: "2026-05-18T08:00:00Z"
    });
    assert.equal(forum.conversationKind, "forum_thread");
    assert.match(forum.memoryFile, /memory\/discord\/guilds\/guild-1\/channels\/123\/threads\/forum-post-1\/events\/2026-05\.jsonl$/);
    assert.match(readFileSync(forum.memoryFile, "utf8"), /"conversationKind":"forum_thread"/);

    const dm = appendDiscordMessageEvent(root, goals, {
      messageId: "m-dm",
      channelId: "dm-channel-1",
      channelType: "DM",
      isDirectMessage: true,
      direction: "inbound",
      authorId: "u1",
      content: "dm body",
      timestamp: "2026-05-18T08:00:00Z"
    });
    assert.equal(dm.conversationKind, "dm");
    assert.equal(dm.reason, "recorded Discord memory without group transcript");
    assert.match(dm.memoryFile, /memory\/discord\/dms\/dm-channel-1\/events\/2026-05\.jsonl$/);
    assert.match(readFileSync(dm.memoryFile, "utf8"), /dm body/);
  } finally {
    removeTempRoot(root);
  }
});

test("appendDiscordMemoryEvent is idempotent by message id and direction", () => {
  const root = makeTempRoot();
  try {
    const event = {
      type: "message",
      messageId: "m-memory",
      guildId: "guild-1",
      channelId: "chan-1",
      direction: "inbound",
      authorType: "human",
      content: [{ type: "text", text: "hello" }],
      timestamp: "2026-05-18T08:00:00Z"
    };
    const first = appendDiscordMemoryEvent(root, event);
    const second = appendDiscordMemoryEvent(root, { ...event, content: [{ type: "text", text: "hello again" }] });
    assert.equal(first.memoryAppended, true);
    assert.equal(second.memoryDuplicate, true);
    assert.equal(readFileSync(first.memoryFile, "utf8").trim().split("\n").length, 1);
  } finally {
    removeTempRoot(root);
  }
});

test("auditDiscordMemory reports coverage across conversation kinds", () => {
  const root = makeTempRoot();
  try {
    writeFixture(root);
    ensureAllGroupWorkspaces(root);
    const goals = loadGoals(root);
    appendDiscordMessageEvent(root, goals, {
      messageId: "m-channel",
      guildId: "guild-1",
      channelId: "123",
      direction: "inbound",
      authorType: "human",
      content: "channel body"
    });
    appendDiscordMessageEvent(root, goals, {
      messageId: "m-dm",
      channelId: "dm-1",
      channelType: "DM",
      direction: "outbound",
      agentSlug: "tianclaw",
      content: "dm body"
    });

    const audit = auditDiscordMemory(root);
    assert.equal(audit.files, 2);
    assert.equal(audit.events, 2);
    assert.equal(audit.conversationKinds.guild_channel, 1);
    assert.equal(audit.conversationKinds.dm, 1);
    assert.equal(audit.directions.inbound, 1);
    assert.equal(audit.directions.outbound, 1);
    assert.equal(audit.invalidLines, 0);
  } finally {
    removeTempRoot(root);
  }
});

test("auditGroupTranscripts reports direction coverage and missing fields", () => {
  const root = makeTempRoot();
  try {
    writeFixture(root);
    ensureAllGroupWorkspaces(root);
    const goals = loadGoals(root);
    appendDiscordMessageEvent(root, goals, {
      messageId: "m1",
      channelId: "123",
      direction: "inbound",
      authorId: "u1",
      authorType: "human",
      content: "hello"
    });
    appendDiscordMessageEvent(root, goals, {
      messageId: "m2",
      channelId: "123",
      direction: "outbound",
      agentSlug: "tianclaw",
      content: "done"
    });
    appendDiscordMessageEvent(root, goals, {
      channelId: "123",
      authorType: "human",
      content: "missing id"
    });

    const audit = auditGroupTranscripts(root);
    assert.equal(audit.totals.sessions, 1);
    assert.equal(audit.totals.messages, 3);
    assert.equal(audit.totals.directions.inbound, 1);
    assert.equal(audit.totals.directions.outbound, 1);
    assert.equal(audit.totals.directions.unknown, 1);
    assert.equal(audit.totals.missingFields.messageId, 1);
    assert.equal(audit.totals.missingFields.direction, 1);
  } finally {
    removeTempRoot(root);
  }
});

test("sanitizeForGroupSession redacts sensitive keys recursively", () => {
  assert.deepEqual(
    sanitizeForGroupSession({
      content: "safe",
      nested: { authorization: "Bearer abcdefghijklmnopqrstuvwxyz012345" }
    }),
    {
      content: "safe",
      nested: { authorization: "[REDACTED_SECRET]" }
    }
  );
});
