import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { runCli as runCommunicationContractsWrapper } from "../src/audit-communication-contracts.js";
import { auditDiscordGroupRuntime, runCli as runDiscordGroupRuntimeCli } from "../src/audit-discord-group-runtime.js";
import { runCli as runDiscussionLifecycleWrapper } from "../src/audit-discussion-lifecycle.js";
import { runCli as runGroupOrchestrationWrapper } from "../src/audit-group-orchestration-rules.js";
import { runCli as runAgentMemoryCli } from "../src/agent-memory-distillation.js";
import {
  appendDiscordMessageEvent,
  ensureAllGroupWorkspaces,
  loadGoals,
  makeTempRoot,
  removeTempRoot,
  runCli as runGroupWorkspaceCli
} from "../src/group-workspace.js";
import { onboardGroup, runCli as runOnboardGroupCli } from "../src/onboard-discord-group.js";
import { runCli as runSelfCheckCli } from "../src/self-check.js";
import { runCli as runSyncGroupGoalsCli, syncGroupGoals } from "../src/sync-group-goals.js";
import { pruneExpiredDiscordThreadBindings, runCli as runThreadBindingsCli } from "../src/thread-bindings-maintenance.js";
import {
  auditCommonDiscussionStateFields,
  auditCommunicationContracts,
  auditDiscussionLifecycle,
  auditGroupOrchestrationRules,
  auditHostedContract,
  runCli as runDiscussionAuditsCli,
  runCommunicationContractsCli,
  runDiscussionLifecycleCli,
  runGroupOrchestrationRulesCli
} from "../src/discussion-audits.js";

function writeBaseFixture(root) {
  mkdirSync(resolve(root, "workspace/groups/example"), { recursive: true });
  mkdirSync(resolve(root, "cron"), { recursive: true });
  writeFileSync(
    resolve(root, "workspace/groups/company-goals.json"),
    `${JSON.stringify({
      version: 1,
      review: {
        cadenceDays: 14,
        owner: "host",
        statsPath: "workspace/groups/reviews/",
        template: "workspace/groups/reviews/TEMPLATE.md"
      },
      groups: [
        {
          slug: "example",
          name: "Example Desk",
          channelId: "123456789012345678",
          doc: "workspace/groups/example/IDENTITY.md",
          oneLineGoal: "Make examples operational.",
          northStar: "Useful examples shipped.",
          operatingMetrics: ["Specificity rate.", "Closure rate."],
          guardrailMetrics: ["Vague replies.", "Missing owner."]
        }
      ]
    }, null, 2)}\n`
  );
  writeFileSync(
    resolve(root, "workspace/groups/example/IDENTITY.md"),
    [
      "# example",
      "123456789012345678",
      "Make examples operational.",
      "Useful examples shipped.",
      "Specificity rate.",
      "Closure rate.",
      "Vague replies.",
      "Missing owner."
    ].join("\n")
  );
  writeFileSync(
    resolve(root, "openclaw.json"),
    `${JSON.stringify({
      plugins: {
        entries: {
          clawclave: {
            enabled: true,
            config: {
              hostAccountId: "host",
              goalsFile: "workspace/groups/company-goals.json",
              onboardingDir: "workspace/groups/onboarding/active",
              eventsDir: "workspace/groups/discussions/events",
              hostedTurnsDir: "workspace/groups/discussions/active",
              transcriptWriter: true,
              onboarding: true,
              selfCheck: { enabled: false }
            }
          }
        }
      },
      channels: {
        discord: {
          guilds: {
            "*": {
              channels: {
                "123456789012345678": {}
              }
            }
          },
          accounts: {
            host: {},
            expert: {}
          }
        }
      }
    }, null, 2)}\n`
  );
  writeFileSync(resolve(root, "cron/jobs.json"), `${JSON.stringify({ jobs: [] }, null, 2)}\n`);
}

function writeDiscussionFixture(root) {
  mkdirSync(resolve(root, "workspace/groups/discussions/active"), { recursive: true });
  mkdirSync(resolve(root, "workspace/groups/discussions/archive"), { recursive: true });
  mkdirSync(resolve(root, "workspace/groups/discussions/events"), { recursive: true });
  writeFileSync(
    resolve(root, "workspace/groups/communication-contracts.md"),
    "# Contracts\n\nParticipation Event\n\nHosted Discussion\n\nResearch / Evidence Work\n"
  );
  writeFileSync(
    resolve(root, "workspace/groups/discussions/TEMPLATE.json"),
    `${JSON.stringify({
      id: "template",
      workType: "discussion",
      surface: "channel",
      collaboration: "parallel",
      groupSlug: "example",
      channelId: "123456789012345678",
      originMessageId: "m0",
      question: "What should we do?",
      expectedOutput: "synthesis and next action",
      status: "open",
      openedAt: "2026-06-05T00:00:00.000Z",
      lastActivityAt: "2026-06-05T00:00:00.000Z",
      successCriteria: {
        kind: "hosted-discussion",
        requiredVisibleArtifact: "synthesis"
      }
    }, null, 2)}\n`
  );
}

function captureConsole(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  console.error = (...args) => lines.push(args.join(" "));
  try {
    const value = fn();
    return { value, output: lines.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function captureConsoleAsync(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  console.error = (...args) => lines.push(args.join(" "));
  try {
    const value = await fn();
    return { value, output: lines.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("group workspace CLI covers check, context, append, and audit commands", () => {
  const root = makeTempRoot();
  try {
    writeBaseFixture(root);
    ensureAllGroupWorkspaces(root);
    const goals = loadGoals(root);
    const messagePath = resolve(root, "message.json");
    writeFileSync(
      messagePath,
      `${JSON.stringify({
        messageId: "m-cli",
        channelId: "123456789012345678",
        direction: "inbound",
        authorType: "human",
        content: "hello from cli"
      }, null, 2)}\n`
    );

    assert.equal(captureConsole(() => runGroupWorkspaceCli(["--check"], root)).value, 0);
    assert.equal(captureConsole(() => runGroupWorkspaceCli(["--init"], root)).value, 0);
    assert.equal(captureConsole(() => runGroupWorkspaceCli(["--context", "--slug", "example"], root)).value, 0);
    assert.equal(captureConsole(() => runGroupWorkspaceCli(["--context", "--slug", "missing"], root)).value, 1);
    assert.equal(captureConsole(() => runGroupWorkspaceCli(["--append-discord-message", messagePath], root)).value, 0);
    assert.equal(captureConsole(() => runGroupWorkspaceCli(["--append-discord-message", messagePath], root)).value, 2);
    assert.equal(captureConsole(() => runGroupWorkspaceCli(["--audit-discord-memory", "--json"], root)).value, 0);
    assert.equal(captureConsole(() => runGroupWorkspaceCli(["--audit-discord-memory"], root)).value, 0);
    assert.equal(captureConsole(() => runGroupWorkspaceCli(["--audit-transcripts", "--json"], root)).value, 0);
    assert.equal(captureConsole(() => runGroupWorkspaceCli(["--audit-transcripts"], root)).value, 0);

    appendDiscordMessageEvent(root, goals, {
      messageId: "m-session",
      channelId: "123456789012345678",
      direction: "outbound",
      agentSlug: "host",
      content: "session body"
    });
    const eventPath = resolve(root, "group-event.json");
    writeFileSync(eventPath, `${JSON.stringify({ type: "note", content: "event body" }, null, 2)}\n`);
    assert.equal(captureConsole(() => runGroupWorkspaceCli(["--append-event", eventPath, "--slug", "example"], root)).value, 0);
    assert.equal(captureConsole(() => runGroupWorkspaceCli(["--append-event", eventPath, "--slug", "missing"], root)).value, 1);
    const promptContextPath = resolve(root, "prompt-context.json");
    writeFileSync(promptContextPath, `${JSON.stringify({ channelId: "123456789012345678" }, null, 2)}\n`);
    assert.equal(captureConsole(() => runGroupWorkspaceCli(["--prompt-context", promptContextPath], root)).value, 0);
    rmSync(resolve(root, "workspace/groups/example/SOUL.md"), { force: true });
    assert.equal(captureConsole(() => runGroupWorkspaceCli(["--check"], root)).value, 1);
    assert.equal(captureConsole(() => runGroupWorkspaceCli([], root)).value, 0);
    assert.equal(captureConsole(() => runGroupWorkspaceCli(["--unknown"], root)).value, 1);
    assert.equal(captureConsole(() => runGroupWorkspaceCli(["--help"], root)).value, 0);
  } finally {
    removeTempRoot(root);
  }
});

test("discussion audits cover invalid state, hosted contracts, and forbidden patterns", () => {
  const root = makeTempRoot();
  try {
    writeBaseFixture(root);
    writeDiscussionFixture(root);
    mkdirSync(resolve(root, "workspace/groups/discussions/active"), { recursive: true });
    mkdirSync(resolve(root, "workspace/groups/discussions/archive/2026-06"), { recursive: true });
    mkdirSync(resolve(root, "workspace/groups/discussions/events"), { recursive: true });
    const activePath = resolve(root, "workspace/groups/discussions/active/bad.json");
    writeFileSync(
      activePath,
      `${JSON.stringify({
        id: "bad",
        workType: "participation",
        surface: "thread",
        collaboration: "sequential",
        groupSlug: "example",
        channelId: "123456789012345678",
        originMessageId: "m1",
        question: "Join?",
        expectedOutput: "visible replies",
        status: "closed",
        openedAt: "2026-06-05T00:00:00.000Z",
        lastActivityAt: "2026-06-05T00:00:00.000Z",
        deadlineAt: "2020-01-01T00:00:00.000Z",
        contest_state: {},
        class: "old",
        mode: "old",
        successCriteria: { kind: "wrong", requiredVisibleArtifact: "unsupported" },
        delivery: { required: "reaction", visibleMessageRequired: false },
        participants: [{ status: "sent" }, null]
      }, null, 2)}\n`
    );
    writeFileSync(
      resolve(root, "workspace/groups/discussions/archive/2026-06/open.json"),
      `${JSON.stringify({
        id: "archived-open",
        workType: "qa",
        surface: "channel",
        collaboration: "none",
        groupSlug: "example",
        channelId: "123456789012345678",
        originMessageId: "m2",
        question: "Closed?",
        expectedOutput: "answer",
        status: "open",
        openedAt: "2026-06-05T00:00:00.000Z",
        lastActivityAt: "2026-06-05T00:00:00.000Z"
      }, null, 2)}\n`
    );
    writeFileSync(
      resolve(root, "workspace/groups/discussions/events/2026-06.jsonl"),
      [
        "{bad-json",
        JSON.stringify({ type: "host-opened", stateId: "missing", messageId: "m3" }),
        JSON.stringify({ type: "opened", messageId: "m4" }),
        JSON.stringify({ type: "assigned", stateId: null, messageId: "m5", class: "direct-expert" }),
        JSON.stringify({ type: "closed", stateId: "closed-state", messageId: "m6" }),
        JSON.stringify({ type: "opened", stateId: "closed-state", messageId: "m6" })
      ].join("\n") + "\n"
    );
    const commonIssues = auditCommonDiscussionStateFields({ workType: "bad", surface: "bad", collaboration: "bad" }, "x.json", root);
    assert.ok(commonIssues.some((issue) => /state missing id/.test(issue.message)));
    const hostedIssues = auditHostedContract({ workType: "research", successCriteria: { kind: "bad" } }, "r.json", root);
    assert.ok(hostedIssues.some((issue) => /research state requires evidence/.test(issue.message)));
    const lifecycle = auditDiscussionLifecycle(root);
    assert.ok(lifecycle.issues.some((issue) => /invalid JSONL/.test(issue.message)));
    assert.ok(lifecycle.issues.some((issue) => /non-open status/.test(issue.message)));
    assert.ok(lifecycle.issues.some((issue) => /archived state must be closed/.test(issue.message)));
    const contracts = auditCommunicationContracts(root);
    assert.ok(contracts.issues.some((issue) => /participation state requires visible delivery/.test(issue.message)));
    mkdirSync(resolve(root, "workspace/agents/agent-a/workspace/groups/discussions"), { recursive: true });
    assert.ok(auditCommunicationContracts(root).issues.some((issue) => /shadow discussions/.test(issue.message)));
    writeFileSync(resolve(root, "workspace/groups/bad.md"), "contest_state\nreply_format\n");
    const orchestration = auditGroupOrchestrationRules(root, { ignoredPathParts: [] });
    assert.ok(orchestration.issues.some((issue) => /contest state/.test(issue.message)));
  } finally {
    removeTempRoot(root);
  }
});

test("discussion audit CLIs and wrappers report clean fixtures", () => {
  const root = makeTempRoot();
  try {
    writeBaseFixture(root);
    writeDiscussionFixture(root);
    assert.doesNotThrow(() => captureConsole(() => runDiscussionLifecycleCli([], root)));
    assert.doesNotThrow(() => captureConsole(() => runCommunicationContractsCli(["--json"], root)));
    assert.doesNotThrow(() => captureConsole(() => runGroupOrchestrationRulesCli([], root)));
    assert.doesNotThrow(() => captureConsole(() => runDiscussionAuditsCli(["discussion-lifecycle", "--json"], root)));
    assert.doesNotThrow(() => captureConsole(() => runDiscussionLifecycleWrapper(["--json"], root)));
    assert.doesNotThrow(() => captureConsole(() => runCommunicationContractsWrapper(["--json"], root)));
    assert.doesNotThrow(() => captureConsole(() => runGroupOrchestrationWrapper(["--json"], root)));
  } finally {
    removeTempRoot(root);
  }
});

test("Discord group runtime audit covers config, cron, and onboarding checks", () => {
  const root = makeTempRoot();
  try {
    writeBaseFixture(root);
    mkdirSync(resolve(root, "workspace/groups/onboarding/active"), { recursive: true });
    writeFileSync(
      resolve(root, "workspace/groups/onboarding/active/999999999999999999.json"),
      `${JSON.stringify({ status: "pending_goal", channelId: "999999999999999999" }, null, 2)}\n`
    );
    const report = auditDiscordGroupRuntime(root);
    assert.equal(report.knownChannels, 1);
    assert.equal(report.pendingChannels, 1);
    assert.deepEqual(report.issues, []);
    const textCli = captureConsole(() => runDiscordGroupRuntimeCli([], root));
    assert.match(textCli.output, /Discord group runtime audit passed/);
    const cli = captureConsole(() => runDiscordGroupRuntimeCli(["--json"], root));
    assert.match(cli.output, /"knownChannels": 1/);
  } finally {
    removeTempRoot(root);
  }
});

test("Discord group runtime audit reports disabled plugin, cron drift, and weak S&P prompts", () => {
  const root = makeTempRoot();
  try {
    writeBaseFixture(root);
    const config = JSON.parse(readFileSync(resolve(root, "openclaw.json"), "utf8"));
    config.plugins.entries.clawclave.enabled = false;
    writeFileSync(resolve(root, "openclaw.json"), `${JSON.stringify(config, null, 2)}\n`);
    writeFileSync(
      resolve(root, "cron/jobs.json"),
      `${JSON.stringify({
        jobs: [
          {
            id: "unknown",
            name: "Unknown Channel",
            enabled: true,
            delivery: { to: "channel:999999999999999999" },
            sessionKey: "discord:channel:999999999999999999:test",
            payload: { message: "hello" }
          },
          {
            id: "humor-1",
            name: "Humor One",
            enabled: true,
            delivery: { to: "channel:1479019535532163195" },
            payload: { message: "hello" }
          },
          {
            id: "humor-2",
            name: "Humor Two",
            enabled: true,
            delivery: { to: "channel:1479019535532163195" },
            payload: { message: "hello" }
          },
          {
            id: "sp500",
            name: "Weak S&P",
            enabled: true,
            delivery: { to: "channel:1478086002630328501" },
            payload: { message: "market update" }
          }
        ]
      }, null, 2)}\n`
    );
    mkdirSync(resolve(root, "workspace/groups/onboarding/active"), { recursive: true });
    writeFileSync(
      resolve(root, "workspace/groups/onboarding/active/999999999999999999.json"),
      `${JSON.stringify({ status: "pending_goal", channelId: "999999999999999999" }, null, 2)}\n`
    );
    const report = auditDiscordGroupRuntime(root);
    assert.equal(report.enabledJobs, 4);
    assert.ok(report.issues.some((issue) => issue.includes("clawclave plugin must be enabled")));
    assert.ok(report.issues.some((issue) => issue.includes("references channel 999999999999999999")));
    assert.ok(report.issues.some((issue) => issue.includes("pending_goal channel 999999999999999999")));
    assert.ok(report.issues.some((issue) => issue.includes("hahaha-lte-pte has 2 enabled")));
    assert.ok(report.issues.some((issue) => issue.includes("investment-hypothesis")));

    config.plugins.entries.clawclave.enabled = true;
    config.plugins.entries.clawclave.config = { onboarding: false, transcriptWriter: false };
    writeFileSync(resolve(root, "openclaw.json"), `${JSON.stringify(config, null, 2)}\n`);
    const configReport = auditDiscordGroupRuntime(root);
    assert.ok(configReport.issues.some((issue) => issue.includes("missing goalsFile")));
    assert.ok(configReport.issues.some((issue) => issue.includes("onboarding must stay enabled")));
    assert.ok(configReport.issues.some((issue) => issue.includes("transcriptWriter must stay enabled")));
  } finally {
    removeTempRoot(root);
  }
});

test("onboardGroup validates duplicates and runs optional host sync scripts", () => {
  const root = makeTempRoot();
  try {
    writeBaseFixture(root);
    ensureAllGroupWorkspaces(root);
    mkdirSync(resolve(root, "scripts"), { recursive: true });
    writeFileSync(resolve(root, "scripts/sync-group-goals.mjs"), "");
    writeFileSync(resolve(root, "scripts/sync-discord-topics.mjs"), "");
    const result = onboardGroup(root, {
      slug: "ops-lab",
      name: "Ops Lab",
      channelId: "999999999999999999",
      oneLineGoal: "Operate test workflows.",
      northStar: "Workflows closed.",
      op: ["Signal captured.", "Action closed."],
      guardrail: ["Vague state.", "Missing owner."],
      syncOpenclaw: true,
      writeTopic: true
    });
    assert.equal(result.group.slug, "ops-lab");
    assert.throws(
      () => onboardGroup(root, {
        slug: "ops-lab",
        name: "Duplicate",
        channelId: "888888888888888888",
        oneLineGoal: "Duplicate.",
        northStar: "Duplicate.",
        op: ["a", "b"],
        guardrail: ["c", "d"]
      }),
      /group slug already exists/
    );
    assert.throws(
      () => onboardGroup(root, {
        slug: "channel-dup",
        name: "Duplicate Channel",
        channelId: "999999999999999999",
        oneLineGoal: "Duplicate channel.",
        northStar: "Duplicate channel.",
        op: ["a", "b"],
        guardrail: ["c", "d"]
      }),
      /channelId already exists/
    );
    mkdirSync(resolve(root, "workspace/groups/preexisting"), { recursive: true });
    writeFileSync(resolve(root, "workspace/groups/preexisting/IDENTITY.md"), "# already here\n");
    assert.throws(
      () => onboardGroup(root, {
        slug: "preexisting",
        name: "Preexisting",
        channelId: "666666666666666666",
        oneLineGoal: "Preexisting identity.",
        northStar: "Preexisting identity.",
        op: ["a", "b"],
        guardrail: ["c", "d"]
      }),
      /IDENTITY.md already exists/
    );
  } finally {
    removeTempRoot(root);
  }
});

test("onboardGroup CLI covers help, validation errors, success, and next-step output", () => {
  const root = makeTempRoot();
  try {
    writeBaseFixture(root);
    ensureAllGroupWorkspaces(root);
    const help = captureConsole(() => runOnboardGroupCli(["--help"], root));
    assert.equal(help.value, 0);
    assert.match(help.output, /onboard-discord-group/);

    const bad = captureConsole(() => runOnboardGroupCli(["--slug", "BadSlug"], root));
    assert.equal(bad.value, 1);
    assert.match(bad.output, /slug must be lowercase kebab-case/);

    const ok = captureConsole(() => runOnboardGroupCli([
      "--slug", "cli-lab",
      "--name", "CLI Lab",
      "--channel-id", "777777777777777777",
      "--goal", "Exercise CLI onboarding.",
      "--north-star", "CLI onboarding verified.",
      "--op", "Signal captured.",
      "--op", "Action closed.",
      "--guardrail", "Vague state.",
      "--guardrail", "Missing owner."
    ], root));
    assert.equal(ok.value, 0);
    assert.match(ok.output, /Onboarded group cli-lab/);
    assert.match(ok.output, /Next: node scripts\/sync-group-goals.mjs/);
  } finally {
    removeTempRoot(root);
  }
});

test("thread binding maintenance prunes expired bindings and reports CLI state", () => {
  const root = makeTempRoot();
  try {
    mkdirSync(resolve(root, "discord"), { recursive: true });
    writeFileSync(
      resolve(root, "discord/thread-bindings.json"),
      `${JSON.stringify({
        version: 1,
        bindings: {
          idleExpired: { lastActivityAt: 1000, idleTimeoutMs: 1000 },
          ageExpired: { boundAt: 1000, maxAgeMs: 1000 },
          kept: { lastActivityAt: 9000, idleTimeoutMs: 5000, boundAt: 9000, maxAgeMs: 5000 }
        }
      }, null, 2)}\n`
    );
    const check = pruneExpiredDiscordThreadBindings(root, { nowMs: 4000, checkOnly: true });
    assert.deepEqual(check.removed.sort(), ["ageExpired", "idleExpired"]);
    assert.match(readFileSync(resolve(root, "discord/thread-bindings.json"), "utf8"), /idleExpired/);
    const write = pruneExpiredDiscordThreadBindings(root, { nowMs: 4000 });
    assert.deepEqual(write.removed.sort(), ["ageExpired", "idleExpired"]);
    assert.doesNotMatch(readFileSync(resolve(root, "discord/thread-bindings.json"), "utf8"), /idleExpired/);
    const cli = captureConsole(() => runThreadBindingsCli([], root));
    assert.match(cli.output, /Discord thread bindings checked: 1/);
  } finally {
    removeTempRoot(root);
  }
});

test("self-check and memory distillation CLIs cover skipped, JSON, and help branches", async () => {
  const root = makeTempRoot();
  try {
    writeBaseFixture(root);
    const skipped = await captureConsoleAsync(() => runSelfCheckCli(["--root", ".", "--no-delivery"], root));
    assert.match(skipped.output, /Clawclave self-check skipped: self-check disabled/);
    const json = await captureConsoleAsync(() => runSelfCheckCli(["--root", ".", "--no-delivery", "--json"], root));
    assert.match(json.output, /"skipped": true/);
    const help = await captureConsoleAsync(() => runSelfCheckCli(["--help"], root));
    assert.match(help.output, /Usage: clawclave self-check/);

    mkdirSync(resolve(root, "workspace/agents/tianclaw"), { recursive: true });
    const memoryHelp = captureConsole(() => runAgentMemoryCli(["--help"], root));
    assert.match(memoryHelp.output, /distill-agent-memory/);
    const memoryRun = captureConsole(() => runAgentMemoryCli(["--agent", "tianclaw", "--limit", "0"], root));
    assert.match(memoryRun.output, /tianclaw: 0 records/);
  } finally {
    removeTempRoot(root);
  }
});

test("syncGroupGoals CLI covers check and write modes", () => {
  const root = makeTempRoot();
  try {
    writeBaseFixture(root);
    const check = syncGroupGoals(root, { checkOnly: true });
    assert.equal(check.ok, false);
    const write = captureConsole(() => runSyncGroupGoalsCli([], root));
    assert.match(write.output, /Synced 1 group goals/);
    const checked = captureConsole(() => runSyncGroupGoalsCli(["--check"], root));
    assert.match(checked.output, /Group goals synced: 1 groups/);
  } finally {
    removeTempRoot(root);
  }
});
