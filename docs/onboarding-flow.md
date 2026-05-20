# Onboarding Flow

Clawclave treats a Discord channel as mapped when its channel ID appears in the
configured goals file.

## Flow

1. A Discord message enters OpenClaw.
2. Clawclave resolves the Discord `channelId`.
3. Clawclave checks the goals file.
4. If the channel is mapped, the group goal context is injected.
5. If the channel is unmapped, Clawclave creates pending onboarding state and
   injects onboarding instructions.
6. If raw Discord ingress integration is installed, the configured host account
   can also send the visible onboarding question before the normal OpenClaw
   preflight path runs.

## Pending State

Default path:

```text
workspace/groups/onboarding/active/<channel-id>.json
```

Example:

```json
{
  "version": 1,
  "status": "pending_goal",
  "provider": "discord",
  "guildId": "123",
  "channelId": "456",
  "firstSeenAt": "2026-05-20T00:00:00.000Z",
  "firstMessageId": "789",
  "requiredFields": [
    "slug",
    "name",
    "oneLineGoal",
    "northStar",
    "operatingMetrics",
    "guardrailMetrics"
  ]
}
```

## Human Confirmation

Clawclave does not invent durable group goals. The host agent should ask a human
for:

- slug
- group name
- one-line goal
- north star
- two operating metrics
- two guardrail metrics

After confirmation, write the goals file, create the group workspace, and sync
any derived OpenClaw or Discord configuration used by your deployment.

## Boundary

Clawclave is the OpenClaw-facing group operations layer. It does not replace raw
Discord gateway logging, token management, or the official Discord channel
plugin.
