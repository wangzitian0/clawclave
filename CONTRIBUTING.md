# Contributing

Thanks for improving Clawclave.

## Development

```bash
npm test
npm run check
```

## Pull Requests

- Keep runtime dependencies minimal.
- Do not commit credentials, tokens, Discord auth material, or private
  deployment state.
- Add tests for config parsing, Discord ID resolution, prompt context, and
  transcript writes.
- Keep the plugin generic. Deployment-specific sync scripts should live outside
  this repository unless they are safe and broadly reusable.

## Commit Style

Use concise, imperative commit messages:

```text
Add onboarding state writer
Document OpenClaw plugin config
```
