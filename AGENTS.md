<!-- WS_STATIC_START adapter=rules-v2 inputs=c236d01ff86579caa880311b904f1b7b179117aa267b5b946ee297bd7f04cc15 -->
<!-- Generated file: do not edit by hand. These rules are maintained in the owner's rule source and re-rendered here. -->

## Engineering discipline

- **Measure the physical system first.** Before an abstract architecture proposal, inspect the system with read-only probes such as `time cmd`, process chains, and file-descriptor locks. A conceptually neat story without physical evidence is insufficient. A probe must not write. Do not combine validation and action in one command: a POST permission probe can create a resource, and a trial commit can leave a real commit. Measure, read the result, then decide, with a stop point between these steps.
- **Green does not prove truth.** The tested system writes its own unit tests, CI, and issue states. Cross-check critical conclusions against two external sources not written by this repository.
- **Tests must be falsifiable.** Do not hide assertions in `if (exists)` or `if (code != 0)` so failures run zero assertions. Do not accept tautologies such as `typeof null === 'object'` or `result !== undefined || true`. Source-text `indexOf` matches against prose are not integration tests. Duplicate test function identifiers can silently shadow earlier tests (Python `def` and duplicate JS function/const/export names); duplicate string titles in `test()` or `it()` instead run both. A green count is not coverage evidence. Make a new test fail under a relevant mutation. A read-only reviewer treats such fake-test patterns as CRITICAL merge blockers.
- **One source of truth:** Keep one authoritative definition for each core fact. Repeated hardcoding and scattered configuration invite drift.
- **Clean up during migration:** After the new mechanism is live and equivalence is proved, remove its predecessor, obsolete files, and dead code in the same change. Define contracts first and derive CI from them.
- **Deletion can leave guards green and empty:** A guard for an old structure can stop checking anything after deletion. Check each guard and remove it or redirect it to the new structure; green tests alone do not prove safe deletion.
- **Define guard scope from what it must govern, not from today's passing tree.** Let the guard fail on existing violations, then repair them. A guard never seen failing is not yet evidence of protection.

## Delivery and merge

- **Fail fast left to right:** Put the cheapest and likeliest failure checks first.
- **Review standing authorization:** Resolve a review thread directly after independently verifying it is fixed or obsolete. Do not resolve actionable, ambiguous, or unverified feedback. Automated reviewers may read a redacted GitHub diff rather than source: GitHub can show `"Authorization": f"Bearer ******"` where source has `"Authorization": f"Bearer {token}"`. Check source before judging a report. When a report is false, turn the concern into a falsifiable invariant test rather than merely dismissing it.
- **Weighted review gates:** Each repository defines its own severity weights and blocking thresholds. Read literal `severity: <level>` tags; do not infer severity from prose.
- **Merge when ready:** Once all merge conditions pass, merge and continue from the latest main rather than piling up divergent branches.

# Clawclave — Agent Guidelines

> **Repository Archetype**: `plugin` (OpenClaw Discord extension, published to npm)
> **Rule Carrier**: `AGENTS.md` is generated; `CLAUDE.md` is a symlink to it. Do not edit either by hand.
> **Merge Authority**: PRs whose CI is green may be merged by agents per the owner's standing grant. Publishing a release to npm is production and stays with the owner.

## Verification

- `npm run verify` (syntax check plus `node --test`) must pass on every supported Node line in CI (20, 22, 24) before merge.
- `npm run coverage:check` enforces the coverage gate (95% statements, functions, and lines; 70% branches). Raise coverage with meaningful tests; never lower the thresholds.
- Add tests for config parsing, Discord ID resolution, prompt context, and transcript writes when touching them.

## Boundaries

- Keep runtime dependencies minimal.
- Never commit credentials, tokens, Discord auth material, or private deployment state.
- Keep the plugin generic. Deployment-specific sync scripts live outside this repository unless they are safe and broadly reusable.
- Commit messages are concise and imperative (`Add onboarding state writer`).
<!-- WS_STATIC_END -->
