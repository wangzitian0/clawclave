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
  "hostAccountId": "tianclaw",
  "promptContext": true,
  "transcriptWriter": true,
  "onboarding": true,
  "hostedTurns": true,
  "hostedTurnMinWaitSeconds": 45,
  "hostedTurnMaxWaitSeconds": 120,
  "tailEvents": 12
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
which expert agents TianClaws mentioned in a hosted turn.

`hostAccountId`

OpenClaw Discord account that is allowed to send a visible onboarding prompt.
This avoids every bot in a multi-account Discord server asking the same
question. Default: `tianclaw`.

`promptContext`

When true, Clawclave injects mapped or unmapped group context into Discord agent
runs through `before_prompt_build`.

`transcriptWriter`

When true, Clawclave records normalized inbound and outbound hook events.

`onboarding`

When true, Clawclave creates pending onboarding state for unmapped channels.

`hostedTurns`

When true, TianClaws outbound expert mentions with assignment language open a
lightweight active hosted turn. This is intentionally conservative and prefers
missed summaries over accidental bot loops.

`hostedTurnMinWaitSeconds`

Earliest point at which TianClaws should summarize after enough expected
participants have replied. Default: `45`.

`hostedTurnMaxWaitSeconds`

Deadline after which stale expert replies should be treated conservatively.
Default: `120`.

`tailEvents`

Maximum recent transcript events to include in prompt context. Range: 0 to 50.
