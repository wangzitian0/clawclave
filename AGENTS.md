# Clawclave — Agent Guidelines

> **Repository Archetype**: `plugin` (OpenClaw Discord extension, published to npm)
> **Authority**: This repository owns its own `AGENTS.md` directly.
> **Merge Authority**: PRs whose CI is green may be merged by agents per the owner's standing grant. Publishing a release to npm is this repository's production release.

## Production reservation

The single definition of the production reservation. Other tiers, skills and gates point here.

- **Only a production change returns to the owner.** A production change alters what production runs or stores (deploy, promote or apply to production; production secret write; manual production data write or deletion; production DNS, route or host change; unrecallable release; or scheduled unapproved production code). Each Repo tier names its production paths. A path can be a merge or a release-checkout pull.
- **Approval:** the owner approves the exact commit SHA or release tag of each production change, and is present when it runs. A "deploy" reply covers only the release that it names. Immediately before a production dispatch, get a live reply from the owner.
- **Self-guard:** an edit that removes, narrows or redefines the production reservation needs the owner's approval of its head SHA. This includes an edit that makes fewer production runs wait for the owner (deploy-path approval check, production job classification, or production environment settings). It also covers removing or weakening a pin of this section, its pin test, or the required check that runs the test.
- **Everything else is the agent's:** in any repository the owner owns, every non-production change (including `dev_env` outside the self-guard), staging and canary deploy, release tag, rule text, skill, gate/release code, and required-check edit. Before merging gate or release code, an independent read-only reviewer inspects the head SHA and states whether the gate gets stricter, equal or looser. A looser edit in the self-guard follows the self-guard.
- **Every other hold is a defect:** a rule, skill, label or gate holding non-production work for the owner is a defect. Do the work, then fix the hold. `ws_owner_scope` fails on it.

## Verification

- `npm run verify` (syntax check plus `node --test`) must pass on every supported Node line in CI (20, 22, 24) before merge.
- `npm run coverage:check` enforces the coverage gate (95% statements, functions, and lines; 70% branches). Raise coverage with meaningful tests; never lower the thresholds.
- Add tests for config parsing, Discord ID resolution, prompt context, and transcript writes when touching them.

## Boundaries

- Keep runtime dependencies minimal.
- Never commit credentials, tokens, Discord auth material, or private deployment state.
- Keep the plugin generic. Deployment-specific sync scripts live outside this repository unless they are safe and broadly reusable.
- Commit messages are concise and imperative (`Add onboarding state writer`).
