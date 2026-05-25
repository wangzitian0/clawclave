# Hosted Mention Turns

Hosted mention turns are Clawclave's conservative coordination mode for group
agent discussions.

## Principle

Prefer silence over bot chatter. Clawclave records the turn and gives the host
agent bounded context, but it does not let uninvited agents join a discussion.

## Flow

1. The host agent sends a Discord message that mentions one or more expert
   agents and includes assignment language such as "reply", "review", "每人",
   "复核", or "本轮".
2. Clawclave creates active state in `workspace/groups/discussions/active/`.
3. Mentioned expert agents answer at most once according to their Discord
   mention policy and persona instructions.
4. Clawclave records expected replies as they enter OpenClaw.
5. The host agent uses the active state to decide whether to summarize or open a
   new round.

## State Shape

```json
{
  "version": 1,
  "status": "open",
  "mode": "hosted-mention",
  "hostAccountId": "host",
  "expectedAgents": [
    { "accountId": "linus", "botUserId": "147...", "roleId": "147..." }
  ],
  "receivedAgents": [],
  "summaryEligibleAt": "2026-05-20T00:00:45.000Z",
  "deadlineAt": "2026-05-20T00:02:00.000Z",
  "policy": {
    "preferSilenceOverNoise": true,
    "expectedRepliesPerAgent": 1
  }
}
```

## Boundary

Hosted mention turns are a weak coordination layer. They are not a hard token
gate. The hard-gate version requires provider-level `canRead` checks before
agent prompt construction.
