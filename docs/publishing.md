# Publishing

Clawclave is packaged as an npm module. Before publishing, run:

```bash
npm run verify
npm run pack:dry-run
```

The package is currently configured for the public npm registry with public
access. The publish guard is `prepublishOnly`, so `npm publish` runs the syntax
checks and test suite before uploading.

## First Publish

1. Confirm the package name is still available:

   ```bash
   npm view clawclave version --registry=https://registry.npmjs.org
   ```

   A 404 means the unscoped package name is available.

2. Authenticate with an npm account that owns the package:

   ```bash
   npm login
   npm whoami
   ```

3. Publish the first public version:

   ```bash
   npm publish --access public
   ```

## Provenance

Prefer GitHub Actions trusted publishing or `npm publish --provenance` from a
supported cloud runner for release builds. Local manual publishing is acceptable
for a first private test release, but it will not provide the same provenance
signal.

## Release Hygiene

- Keep `README.md`, `LICENSE`, `SECURITY.md`, and `CHANGELOG.md` current.
- Bump `package.json` with semver before every publish.
- Run `npm pack --dry-run` and inspect the tarball file list.
- Do not publish runtime credentials, local state, transcripts, or host-specific
  OpenClaw volume data.
