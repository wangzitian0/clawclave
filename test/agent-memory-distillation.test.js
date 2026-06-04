import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  distillAgentMemory,
  listAgentIds,
  readAgentTurnRecords
} from "../src/agent-memory-distillation.js";

function tempRoot() {
  return mkdtempSync(resolve(tmpdir(), "clawclave-memory-"));
}

test("distillAgentMemory writes reviewed candidate memory under the agent workspace", () => {
  const root = tempRoot();
  try {
    mkdirSync(resolve(root, "workspace/agents/tianclaw"), { recursive: true });
    mkdirSync(resolve(root, "memory/clawclave/openclaw/turns/discord/accounts/tianclaw/sessions/s1"), { recursive: true });
    writeFileSync(
      resolve(root, "memory/clawclave/openclaw/turns/discord/accounts/tianclaw/sessions/s1/2026-06.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-04T01:00:00.000Z",
          direction: "inbound",
          phase: "accepted_input",
          channelId: "c1",
          sessionKey: "s1",
          content: "这个不对，为什么没有回复"
        }),
        JSON.stringify({
          timestamp: "2026-06-04T01:01:00.000Z",
          direction: "outbound",
          phase: "output_result",
          channelId: "c1",
          sessionKey: "s1",
          content: "我会修复 Bearer abcdefghijklmnopqrstuvwxyz012345"
        })
      ].join("\n") + "\n"
    );

    assert.deepEqual(listAgentIds(root), ["tianclaw"]);
    assert.equal(readAgentTurnRecords(root, "tianclaw").length, 2);

    const result = distillAgentMemory(root, "tianclaw", { date: "2026-06-04T02:00:00.000Z" });
    assert.equal(result.records, 2);
    assert.equal(result.outputFile, resolve(root, "workspace/agents/tianclaw/memory/distilled/2026-06-04.md"));
    assert.equal(existsSync(result.outputFile), true);
    const body = readFileSync(result.outputFile, "utf8");
    assert.match(body, /Reviewed: false/);
    assert.match(body, /这个不对/);
    assert.match(body, /\[REDACTED_SECRET\]/);
    assert.doesNotMatch(body, /abcdefghijklmnopqrstuvwxyz012345/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
