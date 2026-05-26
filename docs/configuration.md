# Configuration

Clawclave is configured from the `plugins.entries.clawclave.config` object in
`openclaw.json`.

## Options

```json
{
  "rootDir": "~/.openclaw",
  "goalsFile": "workspace/groups/company-goals.json",
  "memoryDir": "memory/clawclave",
  "onboardingDir": "workspace/groups/onboarding/active",
  "hostedTurnsDir": "workspace/groups/discussions/active",
  "eventsDir": "workspace/groups/discussions/events",
  "agentRoleMapFile": "workspace/agents/discord-agent-roles.json",
  "hostAccountId": "host",
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
}
```

## Field Reference

`rootDir`

OpenClaw data root. Relative paths below are resolved from this directory.

`goalsFile`

JSON file containing the group source of truth. The file should contain a
`groups` array with `channelId`, `slug`, `name`, `oneLineGoal`, `northStar`,
`operatingMetrics`, and `guardrailMetrics`.

`memoryDir`

Base directory for normalized transcript JSONL.

`onboardingDir`

Directory where unmapped Discord channels get pending onboarding state.

`hostedTurnsDir`

Directory where lightweight active hosted-turn state is written.

`eventsDir`

Directory where compact discussion orchestration events are appended.

`agentRoleMapFile`

Discord agent role and bot-user mapping. Clawclave uses this file to identify
which expert agents the host agent mentioned in a hosted turn.

`hostAccountId`

OpenClaw Discord account that is allowed to send a visible onboarding prompt.
This avoids every bot in a multi-account Discord server asking the same
question. Default: `host`.

`promptContext`

When true, Clawclave injects mapped or unmapped group context into Discord agent
runs through `before_prompt_build`.

`transcriptWriter`

When true, Clawclave records normalized inbound and outbound hook events.

`discordRawJournal`

When true, Clawclave records Discord inbound and outbound evidence JSONL. The
inbound side is written from OpenClaw hooks and from periodic Discord catchup.

`openclawTurnJournal`

When true, Clawclave records OpenClaw accepted input, output intent, and
outbound result JSONL.

`onboarding`

When true, Clawclave creates pending onboarding state for unmapped channels.

`hostedTurns`

When true, host-account outbound expert mentions with assignment language open a
lightweight active hosted turn. This is intentionally conservative and prefers
missed summaries over accidental bot loops.

`hostedTurnMinWaitSeconds`

Earliest point at which the host agent should summarize after enough expected
participants have replied. Default: `45`.

`hostedTurnMaxWaitSeconds`

Deadline after which stale expert replies should be treated conservatively.
Default: `120`.

`tailEvents`

Maximum recent transcript events to include in prompt context. Range: 0 to 50.

`catchup`

Periodic Discord REST backfill for recent channel history. It repairs messages
missed during process restart or provider offline windows. `lookbackMinutes`
controls how far back each scan goes, `intervalMinutes` controls scan cadence,
and `maxPagesPerChannel` caps Discord API pagination.

`selfCheck`

Weekly long-running maintenance check. It runs catchup first, writes a compact
state file, then posts the report to `setupChannelId` under `threadName`,
creating the thread when Discord permissions allow it.
