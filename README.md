# Clawclave

[![npm version](https://img.shields.io/npm/v/clawclave.svg)](https://www.npmjs.com/package/clawclave)
[![CI](https://github.com/wangzitian0/clawclave/actions/workflows/ci.yml/badge.svg)](https://github.com/wangzitian0/clawclave/actions/workflows/ci.yml)
[![Coverage Status](https://coveralls.io/repos/github/wangzitian0/clawclave/badge.svg?branch=main)](https://coveralls.io/github/wangzitian0/clawclave?branch=main)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node: >=20](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](package.json)
[![OpenClaw plugin](https://img.shields.io/badge/OpenClaw-plugin-111827.svg)](openclaw.plugin.json)

Discord group operations, onboarding, and evidence journals for OpenClaw.

Clawclave is an OpenClaw native plugin that helps Discord-based agent teams keep
group goals, onboarding state, and conversation transcripts organized as
data-as-code. It is designed for operators who run multiple OpenClaw agents in
Discord and need a clear source of truth for what each channel is for.

Status: pre-1.0. The public plugin API is intended to be small and stable, but
configuration defaults may still change as OpenClaw Discord workflows mature.

## Why Clawclave

OpenClaw can already talk to Discord. Clawclave adds the missing operations
layer for long-lived Discord agent groups:

- What is this channel for?
- Which host account is allowed to initialize or route work?
- Which messages became OpenClaw inputs and outputs?
- Did a restart window drop Discord messages, and can we backfill them?
- Can group memory be reviewed in Git instead of living only in chat history?

## What It Does

- Injects Discord group context into OpenClaw agent prompts.
- Detects unmapped Discord channels and creates onboarding state.
- Records normalized inbound and outbound transcript events.
- Records Discord raw journals and OpenClaw turn journals for evidence.
- Runs Discord catchup and a weekly self-check report for missed-message repair.
- Keeps group goals in a portable JSON source of truth.
- Defines hosted discussion, participation, research, and onboarding contracts.
- Audits discussion lifecycle state, communication contracts, and deprecated
  orchestration residue.
- Provides marketplace-ready metadata for OpenClaw plugin discovery.

Clawclave does not replace the official Discord channel plugin. It sits beside
`@openclaw/discord` and adds group operations on top of Discord message flows.

## Quick Start

Install from npm after the package is published:

```bash
mkdir -p ~/.openclaw/plugins
npm install --prefix ~/.openclaw/plugins clawclave
```

Then point OpenClaw at the installed package:

```json
{
  "plugins": {
    "allow": ["clawclave"],
    "load": {
      "paths": ["~/.openclaw/plugins/node_modules/clawclave"]
    },
    "entries": {
      "clawclave": {
        "enabled": true,
        "config": {
          "rootDir": "~/.openclaw",
          "goalsFile": "workspace/groups/company-goals.json",
          "memoryDir": "memory/clawclave",
          "hostAccountId": "host",
          "promptContext": true,
          "transcriptWriter": true,
          "discordRawJournal": true,
          "openclawTurnJournal": true,
          "onboarding": true,
          "hostedTurns": true
        },
        "hooks": {
          "allowPromptInjection": true
        }
      }
    }
  }
}
```

Restart OpenClaw and send a message in a mapped Discord channel. If the channel
is not mapped, Clawclave creates onboarding state and the configured host agent
asks for the channel goal.

## Use Cases

- New Discord channel onboarding for agent communities.
- Per-channel goals, north-star metrics, operating metrics, and guardrails.
- OpenClaw group memory that is easy to review in Git.
- Host-agent workflows where one coordinator routes work to specialist agents.
- Discord AI operations with auditable group context.

## Installation

For active development, clone this plugin into your OpenClaw data directory:

```bash
git clone git@github.com:wangzitian0/clawclave.git ~/.openclaw/plugins/clawclave
```

Then add it to `openclaw.json`:

```json
{
  "plugins": {
    "allow": ["clawclave"],
    "load": {
      "paths": ["~/.openclaw/plugins/clawclave"]
    },
    "entries": {
      "clawclave": {
        "enabled": true,
        "config": {
          "rootDir": "~/.openclaw",
          "goalsFile": "workspace/groups/company-goals.json",
          "hostAccountId": "host",
          "hostedTurnsDir": "workspace/groups/discussions/active",
          "eventsDir": "workspace/groups/discussions/events",
          "agentRoleMapFile": "workspace/agents/discord-agent-roles.json",
          "promptContext": true,
          "transcriptWriter": true,
          "discordRawJournal": true,
          "openclawTurnJournal": true,
          "onboarding": true,
          "hostedTurns": true,
          "hostedTurnMinWaitSeconds": 45,
          "hostedTurnMaxWaitSeconds": 120,
          "tailEvents": 12,
          "catchup": {
            "enabled": true,
            "lookbackMinutes": 180,
            "intervalMinutes": 10,
            "maxPagesPerChannel": 4
          },
          "selfCheck": {
            "enabled": true,
            "intervalHours": 168,
            "setupChannelId": "123456789012345678",
            "threadName": "Clawclave weekly persistence audit"
          }
        },
        "hooks": {
          "allowPromptInjection": true
        }
      }
    }
  }
}
```

Restart OpenClaw after enabling the plugin.

## Group Goals File

By default, Clawclave reads:

```text
workspace/groups/company-goals.json
```

Minimal shape:

```json
{
  "version": 1,
  "groups": [
    {
      "slug": "ops",
      "name": "Operations",
      "channelId": "123456789012345678",
      "oneLineGoal": "Turn incidents into verified state and next action.",
      "northStar": "Issues closed with evidence.",
      "operatingMetrics": [
        "Time to first diagnosis.",
        "Issues with explicit owner and next step."
      ],
      "guardrailMetrics": [
        "Repeated fixes without documentation.",
        "Unverified assumptions."
      ]
    }
  ]
}
```

## New Channel Onboarding

When Clawclave sees a Discord channel that is not listed in the goals file, it:

1. Creates a pending onboarding record.
2. Injects onboarding instructions into the next OpenClaw prompt.
3. Lets one configured host account send the visible onboarding question.
4. Tells the host agent to ask for:
   - one-line goal
   - north star
   - two operating metrics
   - two guardrail metrics

Pending state is written to:

```text
workspace/groups/onboarding/active/<channel-id>.json
```

## Hosted Mention Turns

When the configured host account mentions one or more mapped expert agents with
assignment language, Clawclave opens a lightweight hosted turn:

```text
workspace/groups/discussions/active/<channel-or-thread-id>.json
```

This is a conservative coordination layer, not a hard token gate. Experts are
still expected to rely on Discord mentions and their own prompt rules, while
the host agent uses the hosted turn state to decide whether expected replies
have arrived and whether to summarize. The default policy prefers silence over
extra bot chatter.

Clawclave intentionally does not invent durable group goals. A human should
confirm the goal before writing it into the source of truth.

## Host Repository Wrappers

Host repositories can keep familiar operational commands as thin wrappers while
depending on Clawclave for implementation. The reusable commands are:

```bash
clawclave group-workspace --check
clawclave sync-group-goals --check
clawclave onboard-discord-group --help
clawclave audit-discord-group-runtime
clawclave audit-discussion-lifecycle
clawclave audit-communication-contracts
clawclave audit-group-orchestration-rules
clawclave prune-expired-discord-thread-bindings --check
```

Keep private group data, runtime config, credentials, and production snapshots in
the host repository or OpenClaw volume. Keep reusable group workspace,
onboarding, transcript, hosted-flow contracts, and audit logic in this plugin.

## Hosted Flow Contracts

Clawclave owns the generic protocol for Discord group coordination:

- interaction taxonomy: `docs/interaction-taxonomy.md`
- success contracts: `docs/communication-contracts.md`
- group workspace contract: `docs/group-workspace-contract.md`
- group session schema: `docs/group-session-schema.md`
- discussion event schema: `schemas/discussion-event.schema.json`
- discussion state template: `schemas/discussion-state.template.json`

Host repositories own actual group goals, channel IDs, agent rosters, session
logs, historical discussion events, credentials, and deployment data.

## Transcript Memory

When `transcriptWriter` is enabled, normalized events are appended under:

```text
memory/clawclave/transcripts/
```

This is not a replacement for raw Discord gateway logs. Treat it as the
OpenClaw-facing, normalized transcript layer.

## Persistence Journals

Clawclave keeps four evidence layers when the corresponding options are enabled:

- Discord inbound evidence: `memory/clawclave/discord/raw/...`
- OpenClaw accepted input: `memory/clawclave/openclaw/turns/...`
- OpenClaw output intent: `memory/clawclave/openclaw/turns/...`
- Discord outbound result: `memory/clawclave/discord/raw/outbound/...`

The plugin also runs periodic Discord catchup from recent channel history. This
cannot observe messages that Discord no longer returns or channels the host
account cannot read, but it repairs the common restart/provider-offline window.
The weekly self-check runs catchup first, then posts a compact report to the
configured setup thread, creating that thread when possible.

## Configuration

See [docs/configuration.md](docs/configuration.md).

## Operations

See [docs/operations.md](docs/operations.md) for the runtime file layout,
persistence guarantees, and self-check behavior.

## Onboarding Design

See [docs/onboarding-flow.md](docs/onboarding-flow.md).

## Publishing

See [docs/publishing.md](docs/publishing.md). The package uses `prepublishOnly`
to run syntax checks and tests before `npm publish`.

## Development

```bash
npm run verify
npm test
npm run coverage
npm run pack:dry-run
```

`npm run coverage` writes `coverage/lcov.info`, which the GitHub Actions
workflow uploads to Coveralls.

This repository is intentionally dependency-light. The runtime uses Node.js
built-ins and OpenClaw's plugin entry API.

## Support Matrix

- Node.js: 20 or newer.
- OpenClaw: `>=2026.5.3` as an optional peer dependency.
- Discord: requires an OpenClaw Discord setup with readable channel history for
  catchup/self-check repair.

## Security And Privacy

Clawclave never needs Discord tokens in this repository. Runtime credentials
belong in your OpenClaw deployment. Transcript and raw journal files can contain
private user messages, so treat generated `memory/clawclave/**` data as private
unless you have reviewed and redacted it. See [SECURITY.md](SECURITY.md).

## Keywords

OpenClaw plugin, Discord AI agents, Discord bot operations, group onboarding,
agent orchestration, AI community management, Discord transcript memory,
OpenClaw marketplace plugin.

## License

MIT
