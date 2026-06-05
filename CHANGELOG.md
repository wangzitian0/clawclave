# Changelog

## 0.1.1

- Raised package coverage gates to 95% for statements, functions, and lines.
- Added operational CLI and audit coverage for group workspaces, onboarding,
  self-check, thread binding maintenance, discussion audits, and runtime health
  guards.
- Made `onboard-discord-group` expose a testable `runCli()` entry point.
- Kept the OpenClaw SDK adapter entry excluded from unit coverage because it
  depends on the peer OpenClaw plugin SDK at runtime.

## 0.1.0

- Initial marketplace-ready OpenClaw native plugin.
- Added Discord group context prompt injection.
- Added normalized transcript JSONL writer.
- Added unmapped-channel onboarding state.
- Added configuration, onboarding, and installation documentation.
- Added hosted-flow contract docs, discussion schemas, and reusable lifecycle
  audits for host repositories.
- Generalized host-agent defaults and examples so private deployments supply
  their own `hostAccountId`.
