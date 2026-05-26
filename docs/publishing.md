# Publishing

Clawclave is packaged as an npm module. Before publishing, run:

```bash
npm run verify
npm run coverage
npm run coverage:check
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

2. Configure npm trusted publishing for GitHub Actions if npm already exposes
   package settings for `clawclave`:

   - package: `clawclave`
   - owner/repository: `wangzitian0/clawclave`
   - workflow: `publish.yml`
   - environment: `npm`

   Trusted publishing uses GitHub Actions OIDC instead of a long-lived npm
   token. The publish workflow grants `id-token: write`, runs on a
   GitHub-hosted runner, and uses Node.js 24 with npm 11.

3. If this is the first-ever publish and npm does not yet expose package
   settings for `clawclave`, authenticate locally and publish once:

   ```bash
   npm login
   npm whoami
   npm publish --access public
   ```

   After the package exists, configure trusted publishing before publishing the
   next version.

4. Publish later public versions from GitHub Actions:

   - open Actions -> Publish to npm
   - run workflow on `main`
   - keep the distribution tag as `latest`

   The workflow runs `npm ci`, `npm run verify`, `npm run coverage:check`, and
   `npm run pack:dry-run` before publishing.

5. Manual fallback after first publish, only if trusted publishing is
   unavailable:

   ```bash
   npm publish --access public
   ```

## Provenance

Prefer GitHub Actions trusted publishing for release builds. npm automatically
generates provenance attestations for public packages published from public
GitHub repositories through trusted publishing.

If trusted publishing is not available and a token-based workflow must be used,
use `npm publish --provenance --access public` from a supported cloud runner.
Local manual publishing is acceptable only as a fallback and will not provide
the same provenance signal.

## Coverage

Coverage is generated with `c8`:

```bash
npm run coverage
```

The command writes `coverage/lcov.info`. CI uploads that LCOV file with
`coverallsapp/github-action@v2`, and the README badge points at the `main`
branch Coveralls report.

`npm run coverage:check` uses the same full-source coverage scope and fails if
global statements, branches, functions, or lines fall below 50%.

The CI workflow also supports manual runs through `workflow_dispatch` so a
maintainer can verify coverage before release even when a GitHub event does not
start automatically.

For a public GitHub repository, the Coveralls GitHub Action can create the
Coveralls repository on first successful upload. If the badge still reports
unknown coverage after CI runs, sign in to Coveralls with GitHub and confirm
that `wangzitian0/clawclave` is enabled. Do not commit Coveralls repo tokens.

## Release Hygiene

- Keep `README.md`, `LICENSE`, `SECURITY.md`, and `CHANGELOG.md` current.
- Bump `package.json` with semver before every publish.
- Commit `package-lock.json` and use `npm ci` in CI and release workflows.
- Run `npm pack --dry-run` and inspect the tarball file list.
- Do not publish runtime credentials, local state, transcripts, or host-specific
  OpenClaw volume data.
