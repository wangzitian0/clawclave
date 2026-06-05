# Operations

Clawclave is designed to keep reusable coordination logic in the plugin while
deployment-specific data stays in the OpenClaw volume or host repository.

## Runtime Data Layout

By default, Clawclave writes under the configured OpenClaw data root:

```text
workspace/groups/company-goals.json
workspace/groups/onboarding/active/<channel-id>.json
workspace/groups/discussions/active/<channel-or-thread-id>.json
workspace/groups/discussions/events/<yyyy-mm>.jsonl
memory/clawclave/transcripts/...
memory/discord/raw/...
memory/openclaw/turns/...
memory/clawclave/catchup/state.json
memory/clawclave/self-check/state.json
memory/clawclave/maintenance/state.json
```

These files are operational evidence, not package source. Do not publish runtime
memory, transcripts, credentials, or host-specific configuration to npm.

`memory/discord/raw/**` and `memory/openclaw/turns/**` are the canonical IO
evidence layers. `memory/clawclave/transcripts/**` is a plugin-owned normalized
projection for prompt context and review. Older deployments may still have
`memory/clawclave/discord/raw/**` or `memory/clawclave/openclaw/turns/**`; treat
those as legacy evidence mirrors, not active write targets.

## Persistence Model

Clawclave records four evidence layers when enabled:

1. `discord_input`: Discord inbound evidence from `message_received` and REST catchup.
2. `openclaw_input`: OpenClaw accepted input from canonical inbound message hooks.
3. `openclaw_output`: OpenClaw output intent from `message_sending`.
4. `discord_output`: Discord outbound result after `message_sent`.

The Discord REST catchup worker repairs the common window where the provider was
offline or restarting. It can only backfill messages the configured host account
can still read from Discord history.

Catchup is persistence-only. It must not create onboarding prompts, open hosted
turn state, update participant state, send Discord messages, add reactions, or
otherwise drive conversation orchestration. Live hooks may update orchestration
state; REST backfill only repairs evidence.

## Daily Self-Check

The self-check worker runs catchup first, audits key-path drift, then posts a
compact report to the configured setup thread. It creates the thread when
Discord permissions allow it. The report includes scanned channel count, fetched
message count, appended record count, duplicate count, channel errors, merged
catchup target counts, drift issues, maintenance worker identity, and next-run
timestamps.

The maintenance worker is guarded by a process-level singleton. A repeated
`gateway_start` replaces the previous worker before scheduling new timers and
writes current state to `memory/clawclave/maintenance/state.json`.

## Operational Guardrails

- Prefer one host account for onboarding and hosted turns.
- Keep `workspace/groups/company-goals.json` reviewed and versioned.
- Treat `memory/clawclave/**` as sensitive unless redacted.
- Keep `catchup.lookbackMinutes` long enough to cover restarts and deploys.
- Check `npm run verify` and `npm run pack:dry-run` before publishing plugin
  releases.
