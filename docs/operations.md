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
memory/clawclave/discord/raw/...
memory/clawclave/openclaw/turns/...
memory/clawclave/catchup/state.json
memory/clawclave/self-check/state.json
```

These files are operational evidence, not package source. Do not publish runtime
memory, transcripts, credentials, or host-specific configuration to npm.

## Persistence Model

Clawclave records four evidence layers when enabled:

1. `discord_input`: Discord inbound evidence from `message_received` and REST catchup.
2. `openclaw_input`: OpenClaw accepted input from canonical inbound message hooks.
3. `openclaw_output`: OpenClaw output intent from `message_sending`.
4. `discord_output`: Discord outbound result after `message_sent`.

The Discord REST catchup worker repairs the common window where the provider was
offline or restarting. It can only backfill messages the configured host account
can still read from Discord history.

## Daily Self-Check

The self-check worker runs catchup first, audits key-path drift, then posts a
compact report to the configured setup thread. It creates the thread when
Discord permissions allow it. The report includes scanned channel count, fetched
message count, appended record count, duplicate count, channel errors, merged
catchup target counts, and drift issues.

## Operational Guardrails

- Prefer one host account for onboarding and hosted turns.
- Keep `workspace/groups/company-goals.json` reviewed and versioned.
- Treat `memory/clawclave/**` as sensitive unless redacted.
- Keep `catchup.lookbackMinutes` long enough to cover restarts and deploys.
- Check `npm run verify` and `npm run pack:dry-run` before publishing plugin
  releases.
