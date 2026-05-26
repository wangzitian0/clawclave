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

1. Discord inbound evidence from OpenClaw message hooks and catchup.
2. OpenClaw accepted input.
3. OpenClaw output intent before dispatch.
4. Discord outbound result after send.

The Discord REST catchup worker repairs the common window where the provider was
offline or restarting. It can only backfill messages the configured host account
can still read from Discord history.

## Weekly Self-Check

The self-check worker runs catchup first, then posts a compact report to the
configured setup thread. It creates the thread when Discord permissions allow
it. The report includes scanned channel count, fetched message count, appended
record count, duplicate count, and channel errors.

## Operational Guardrails

- Prefer one host account for onboarding and hosted turns.
- Keep `workspace/groups/company-goals.json` reviewed and versioned.
- Treat `memory/clawclave/**` as sensitive unless redacted.
- Keep `catchup.lookbackMinutes` long enough to cover restarts and deploys.
- Check `npm run verify` and `npm run pack:dry-run` before publishing plugin
  releases.
