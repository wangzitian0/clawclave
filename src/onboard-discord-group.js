#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { ensureGroupWorkspace } from "./group-workspace.js";

const repoRoot = process.cwd();
const goalsPath = (root) => resolve(root, "workspace/groups/company-goals.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  return `Usage:
  clawclave onboard-discord-group \\
    --slug ops-lab \\
    --name "Ops Lab" \\
    --channel-id 1234567890 \\
    --goal "..." \\
    --north-star "..." \\
    --op "..." --op "..." \\
    --guardrail "..." --guardrail "..." \\
    [--sync-openclaw] [--write-topic]

Creates:
  - workspace/groups/company-goals.json entry
  - workspace/groups/<slug>/IDENTITY.md
  - missing workspace group files via Clawclave group-workspace

Optional:
  --sync-openclaw runs the host repo wrapper scripts/sync-group-goals.mjs
  --write-topic runs the host repo wrapper scripts/sync-discord-topics.mjs --write`;
}

function parseArgs(argv) {
  const parsed = {
    op: [],
    guardrail: [],
    syncOpenclaw: false,
    writeTopic: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return argv[i];
    };
    switch (arg) {
      case "--slug":
        parsed.slug = next();
        break;
      case "--name":
        parsed.name = next();
        break;
      case "--channel-id":
        parsed.channelId = next();
        break;
      case "--goal":
        parsed.oneLineGoal = next();
        break;
      case "--north-star":
        parsed.northStar = next();
        break;
      case "--op":
        parsed.op.push(next());
        break;
      case "--guardrail":
        parsed.guardrail.push(next());
        break;
      case "--sync-openclaw":
        parsed.syncOpenclaw = true;
        break;
      case "--write-topic":
        parsed.writeTopic = true;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function assertSlug(slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug ?? "")) {
    throw new Error("slug must be lowercase kebab-case, for example ops or ops-lab");
  }
}

function assertChannelId(channelId) {
  if (!/^\d{10,30}$/.test(channelId ?? "")) {
    throw new Error("channel-id must be a Discord numeric channel ID");
  }
}

function assertTwo(label, values) {
  if (!Array.isArray(values) || values.length !== 2 || values.some((value) => !value?.trim())) {
    throw new Error(`${label} requires exactly two non-empty values`);
  }
}

function buildIdentity(group) {
  return `# ${group.slug}

- **Discord channel ID:** \`${group.channelId}\`
- **Group name:** ${group.name}
- **One-line goal:** ${group.oneLineGoal}
- **North Star:** ${group.northStar}
- **Operating metrics:** ${group.operatingMetrics[0]} ${group.operatingMetrics[1]}
- **Guardrail metrics:** ${group.guardrailMetrics[0]} ${group.guardrailMetrics[1]}

## Operating Notes

- This group was onboarded through Clawclave.
- Keep durable group decisions here or in \`MEMORY.md\`; do not paste raw chat
  logs or credentials.
`;
}

function buildGroup(opts) {
  return {
    slug: opts.slug,
    name: opts.name,
    channelId: opts.channelId,
    doc: `workspace/groups/${opts.slug}/IDENTITY.md`,
    oneLineGoal: opts.oneLineGoal,
    northStar: opts.northStar,
    operatingMetrics: opts.op,
    guardrailMetrics: opts.guardrail
  };
}

function validateOptions(opts) {
  if (opts.help) return;
  assertSlug(opts.slug);
  assertChannelId(opts.channelId);
  for (const field of ["name", "oneLineGoal", "northStar"]) {
    if (!opts[field]?.trim()) throw new Error(`${field} is required`);
  }
  assertTwo("--op", opts.op);
  assertTwo("--guardrail", opts.guardrail);
}

function runChecked(command, args, root) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe"
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

export function onboardGroup(root = repoRoot, opts) {
  validateOptions(opts);
  const path = goalsPath(root);
  const goals = readJson(path);
  const groups = goals.groups ?? [];
  if (groups.some((group) => group.slug === opts.slug)) {
    throw new Error(`group slug already exists: ${opts.slug}`);
  }
  if (groups.some((group) => group.channelId === opts.channelId)) {
    throw new Error(`channelId already exists in company-goals.json: ${opts.channelId}`);
  }

  const group = buildGroup(opts);
  goals.groups = [...groups, group];
  writeJson(path, goals);

  const groupDir = resolve(root, "workspace/groups", group.slug);
  mkdirSync(groupDir, { recursive: true });
  const identityPath = resolve(groupDir, "IDENTITY.md");
  if (existsSync(identityPath)) {
    throw new Error(`IDENTITY.md already exists for ${group.slug}`);
  }
  writeFileSync(identityPath, buildIdentity(group));
  const created = [identityPath, ...ensureGroupWorkspace(root, group, goals.review)];

  if (opts.syncOpenclaw) {
    runChecked(process.execPath, ["scripts/sync-group-goals.mjs"], root);
  }
  if (opts.writeTopic) {
    runChecked(process.execPath, ["scripts/sync-discord-topics.mjs", "--write"], root);
  }

  return { group, created };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log(usage());
      process.exit(0);
    }
    const result = onboardGroup(repoRoot, opts);
    console.log(`Onboarded group ${result.group.slug} (${result.group.channelId})`);
    for (const path of result.created) {
      console.log(`- ${path}`);
    }
    if (!opts.syncOpenclaw) {
      console.log("Next: node scripts/sync-group-goals.mjs");
    }
    if (!opts.writeTopic) {
      console.log("Next: node scripts/sync-discord-topics.mjs --write");
    }
  } catch (error) {
    console.error(error.message);
    console.error("");
    console.error(usage());
    process.exit(1);
  }
}
