import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  auditCommunicationContracts,
  auditDiscussionLifecycle,
  auditGroupOrchestrationRules
} from "../src/discussion-audits.js";
import { makeTempRoot, removeTempRoot } from "../src/group-workspace.js";

function writeBase(root) {
  mkdirSync(resolve(root, "workspace/groups/discussions/active"), { recursive: true });
  mkdirSync(resolve(root, "workspace/groups/discussions/archive/2026-05"), { recursive: true });
  mkdirSync(resolve(root, "workspace/groups/discussions/events"), { recursive: true });
  mkdirSync(resolve(root, "workspace/agents/example"), { recursive: true });
  writeFileSync(
    resolve(root, "workspace/groups/communication-contracts.md"),
    "# Communication Contracts\n\n## Participation Event\n\n## Hosted Discussion\n\n## Research / Evidence Work\n"
  );
  writeFileSync(
    resolve(root, "workspace/groups/discussions/TEMPLATE.json"),
    JSON.stringify(
      {
        id: "template",
        workType: "discussion",
        surface: "channel",
        collaboration: "single-owner",
        groupSlug: "example",
        channelId: "123",
        originMessageId: "m0",
        question: "What should happen?",
        expectedOutput: "Visible synthesis before close.",
        successCriteria: {
          kind: "hosted-discussion",
          requiredVisibleArtifact: "synthesis"
        },
        status: "open",
        openedAt: "2026-05-20T00:00:00.000Z",
        lastActivityAt: "2026-05-20T00:00:00.000Z",
        currentOwner: "host",
        ownerQueue: ["host"]
      },
      null,
      2
    )
  );
}

function state(overrides = {}) {
  return {
    id: "discussion-1",
    workType: "discussion",
    surface: "channel",
    collaboration: "single-owner",
    groupSlug: "example",
    channelId: "123",
    threadId: null,
    originMessageId: "m1",
    question: "What should happen?",
    expectedOutput: "Visible synthesis before close.",
    successCriteria: {
      kind: "hosted-discussion",
      requiredVisibleArtifact: "synthesis"
    },
    status: "open",
    openedAt: "2026-05-20T00:00:00.000Z",
    lastActivityAt: "2026-05-20T00:00:10.000Z",
    currentOwner: "host",
    ownerQueue: ["host"],
    ...overrides
  };
}

test("auditDiscussionLifecycle accepts closed archived state with close event", () => {
  const root = makeTempRoot();
  try {
    writeBase(root);
    const archived = state({ status: "closed" });
    writeFileSync(
      resolve(root, "workspace/groups/discussions/archive/2026-05/discussion-1.json"),
      `${JSON.stringify(archived, null, 2)}\n`
    );
    writeFileSync(
      resolve(root, "workspace/groups/discussions/events/2026-05.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-05-20T00:00:01.000Z",
        type: "opened",
        channelId: "123",
        messageId: "m1",
        stateId: "discussion-1",
        actor: "host"
      })}\n${JSON.stringify({
        timestamp: "2026-05-20T00:00:20.000Z",
        type: "closed",
        channelId: "123",
        messageId: "m1",
        stateId: "discussion-1",
        actor: "host"
      })}\n`
    );

    const report = auditDiscussionLifecycle(root);
    assert.equal(report.archivedStates, 1);
    assert.deepEqual(report.issues.filter((issue) => issue.severity === "error"), []);
  } finally {
    removeTempRoot(root);
  }
});

test("auditDiscussionLifecycle reports opening event without state", () => {
  const root = makeTempRoot();
  try {
    writeBase(root);
    writeFileSync(
      resolve(root, "workspace/groups/discussions/events/2026-05.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-05-20T00:00:01.000Z",
        type: "opened",
        channelId: "123",
        messageId: "m1",
        stateId: "missing",
        actor: "host"
      })}\n`
    );
    const report = auditDiscussionLifecycle(root);
    assert.ok(report.issues.some((issue) => /missing stateId/.test(issue.message)));
  } finally {
    removeTempRoot(root);
  }
});

test("auditCommunicationContracts enforces participation delivery contract", () => {
  const root = makeTempRoot();
  try {
    writeBase(root);
    writeFileSync(
      resolve(root, "workspace/groups/discussions/active/participation-1.json"),
      `${JSON.stringify(
        state({
          id: "participation-1",
          workType: "participation",
          collaboration: "parallel",
          currentOwner: "host",
          successCriteria: {
            kind: "participation-event",
            requiredVisibleArtifact: "host-summary"
          },
          delivery: {
            required: "message_tool",
            visibleMessageRequired: true
          },
          participants: [
            {
              agentId: "expert",
              name: "Expert",
              mention: "<@1>",
              status: "sent",
              messageId: "m2"
            }
          ]
        }),
        null,
        2
      )}\n`
    );
    const report = auditCommunicationContracts(root);
    assert.deepEqual(report.issues.filter((issue) => issue.severity === "error"), []);
  } finally {
    removeTempRoot(root);
  }
});

test("auditGroupOrchestrationRules reports deprecated state patterns", () => {
  const root = makeTempRoot();
  try {
    mkdirSync(resolve(root, "workspace/groups"), { recursive: true });
    writeFileSync(resolve(root, "workspace/groups/rules.md"), "Do not use contest_state here.");
    const report = auditGroupOrchestrationRules(root, { scanRoots: ["workspace/groups"] });
    assert.ok(report.issues.some((issue) => /contest state/.test(issue.message)));
  } finally {
    removeTempRoot(root);
  }
});
