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
  "hostAccountId": "tianclaw",
  "promptContext": true,
  "transcriptWriter": true,
  "onboarding": true,
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

`tailEvents`

Maximum recent transcript events to include in prompt context. Range: 0 to 50.
