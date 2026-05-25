import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { makeTempRoot, removeTempRoot } from "../src/group-workspace.js";
import { syncGroupGoals } from "../src/sync-group-goals.js";

function writeFixture(root) {
  mkdirSync(resolve(root, "workspace/groups/example"), { recursive: true });
  writeFileSync(
    resolve(root, "workspace/groups/company-goals.json"),
    `${JSON.stringify(
      {
        version: 1,
        review: {
          cadenceDays: 14,
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
      "123",
      "Make the example clear.",
      "Clear example count.",
      "Specificity rate.",
      "Closure rate.",
      "Vague replies.",
      "Missing owner."
    ].join("\n")
  );
  writeFileSync(
    resolve(root, "openclaw.json"),
    `${JSON.stringify(
      {
        plugins: {
          entries: {
            clawclave: {
              config: {
                hostAccountId: "tianclaw"
              }
            }
          }
        },
        channels: {
          discord: {
            accounts: {
              tianclaw: {},
              linus: {}
            }
          }
        }
      },
      null,
      2
    )}\n`
  );
}

test("syncGroupGoals honors configured host account id", () => {
  const root = makeTempRoot();
  try {
    writeFixture(root);
    const report = syncGroupGoals(root);
    assert.equal(report.ok, true);

    const config = JSON.parse(readFileSync(resolve(root, "openclaw.json"), "utf8"));
    const hostPrompt = config.channels.discord.accounts.tianclaw.guilds["*"].channels["123"].systemPrompt;
    const expertPrompt = config.channels.discord.accounts.linus.guilds["*"].channels["123"].systemPrompt;

    assert.match(hostPrompt, /Host rule/);
    assert.match(expertPrompt, /Expert rule/);
  } finally {
    removeTempRoot(root);
  }
});
