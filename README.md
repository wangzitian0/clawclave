# Clawclave

Discord group operations for OpenClaw.

Clawclave is an OpenClaw native plugin that helps Discord-based agent teams keep
group goals, onboarding state, and conversation transcripts organized as
data-as-code. It is designed for operators who run multiple OpenClaw agents in
Discord and need a clear source of truth for what each channel is for.

## What It Does

- Injects Discord group context into OpenClaw agent prompts.
- Detects unmapped Discord channels and creates onboarding state.
- Records normalized inbound and outbound transcript events.
- Keeps group goals in a portable JSON source of truth.
- Provides marketplace-ready metadata for OpenClaw plugin discovery.

Clawclave does not replace the official Discord channel plugin. It sits beside
`@openclaw/discord` and adds group operations on top of Discord message flows.

## Use Cases

- New Discord channel onboarding for agent communities.
- Per-channel goals, north-star metrics, operating metrics, and guardrails.
- OpenClaw group memory that is easy to review in Git.
- Host-agent workflows where one coordinator routes work to specialist agents.
- Discord AI operations with auditable group context.

## Installation

Clone or install this plugin into your OpenClaw data directory:

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
          "hostAccountId": "tianclaw",
          "promptContext": true,
          "transcriptWriter": true,
          "onboarding": true,
          "tailEvents": 12
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

Clawclave intentionally does not invent durable group goals. A human should
confirm the goal before writing it into the source of truth.

## Transcript Memory

When `transcriptWriter` is enabled, normalized events are appended under:

```text
memory/clawclave/transcripts/
```

This is not a replacement for raw Discord gateway logs. Treat it as the
OpenClaw-facing, normalized transcript layer.

## Configuration

See [docs/configuration.md](docs/configuration.md).

## Onboarding Design

See [docs/onboarding-flow.md](docs/onboarding-flow.md).

## Development

```bash
npm test
```

This repository is intentionally dependency-light. The runtime uses Node.js
built-ins and OpenClaw's plugin entry API.

## Keywords

OpenClaw plugin, Discord AI agents, Discord bot operations, group onboarding,
agent orchestration, AI community management, Discord transcript memory,
OpenClaw marketplace plugin.

## License

MIT
