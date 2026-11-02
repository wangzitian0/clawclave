<!-- WS_STATIC_START adapter=rules-v2 inputs=fc4d53ae74c667d22f6b07add14d69b212a1882bb020ff9222d1863e45a4e1cf -->
<!-- Generated file: do not edit by hand. These rules are maintained in the owner's rule source and re-rendered here. -->

## Engineering discipline

- **Measure the physical system first.** Inspect the system with read-only probes (`time cmd`, process chains, file locks) before proposing architecture. Never combine validation and mutation in one command. Measure, read the result, then decide.
- **Green does not prove truth.** The tested system writes its own unit tests, CI, and issue states. Cross-check critical conclusions against two external sources not written by this repository.
- **Tests must be falsifiable.** Never hide assertions inside `if` branches or accept tautologies. Source-text `indexOf` matches against prose are not integration tests. Avoid duplicate test function names that shadow earlier tests. Make every new test fail under a relevant mutation; fake tests are CRITICAL merge blockers.
- **Falsifiable documentation and assertions:** State test requirements, error messages, and specifications in concrete ASD-STE100 terms without vague qualifiers.
- **One source of truth:** Keep one authoritative definition per core fact. Repeated hardcoding and scattered configuration invite drift.
- **Clean up during migration:** After the new mechanism is live and equivalence is proved, remove its predecessor, obsolete files, and dead code in the same change. Define contracts first and derive CI from them.
- **Deletion can leave guards green and empty:** A guard for an old structure can stop checking anything after deletion. Check each guard and remove it or redirect it to the new structure; green tests alone do not prove safe deletion.
- **Define guard scope from what it must govern, not from today's passing tree.** Let the guard fail on existing violations, then repair them. A guard never seen failing is not yet evidence of protection.
- **Worktree self-sufficiency:** Every worktree must resolve its dependencies, toolchain, skills, and configuration internally. Tools and tests must not navigate upward with `../..` to locate files in parent checkouts.
- **Physical context verification:** Static file existence does not prove host runtime context injection. Junior runs non-interactive probes (`-p` or headless exec) with low-cost models, asserting visible specification text across root and deep subdirectories.
- **Host verification scope:** Official host CLIs are the primary execution environment. Regular testing covers Antigravity 2.0 project workspaces (`.agents/skills/` and project rules); standalone desktop chat apps without directory awareness are excluded.
- **Local and remote test segregation:** Inner-loop verification (Senior, Junior, Intern) runs only focused tests on changed files (`pytest <file>::<test> -x`). Full-suite regression runs on remote CI, or locally at most once before merge.
- **Bounded file reads:** Pass `StartLine` and `EndLine` (`<= 800` lines per call) when reading existing files with `read_file` or `view_file`.

## Delivery and merge

- **ASD-STE100 specification for all artifacts:** Write committed artifacts, rules, code, comments, commits, and docs in ASD-STE100 English. Keep instructions `<= 20` words and descriptions `<= 25` words in active voice without vague qualifiers. Operational skills (`skills/**/SKILL.md`) follow the target repository's language policy.
- **Deliverable format:** Deliver a mergeable PR or a traceable issue, rather than a process-only report. Use issues and PRs as the collaboration bus. Search for an existing similar issue before creating one; update it if it exists.
- **Fail fast left to right:** Put the cheapest and likeliest failure checks first.
- **Review standing authorization:** Resolve a review thread after verifying in source code (not redacted diffs) that it is fixed or obsolete. Never resolve actionable or unverified feedback. Turn false reports into falsifiable invariant tests.
- **Weighted review gates:** Each repository defines its own severity weights and blocking thresholds. Read literal `severity: <level>` tags; do not infer severity from prose.
- **Merge when ready:** Once all merge conditions pass, merge and continue from the latest main rather than piling up divergent branches.
- **Delivery state invariant:** Never declare complete, done, or finished before merge to main and a verified Business Reality Probe (`ws-delivery-status`). State labels are `'Draft'`, `'Local verified'`, `'In review'`, `'Stage 1 Landed'`, and `'VERIFIED_COMPLETE'`.
- **Anti-exclusion and reality invariant:** Exclusion is not resolution. Never exclude failing entities or add exemptions to manufacture green checks. A task is complete only when a physical reality probe confirms non-empty execution.
- **Three-stage deployment prerequisite:** Stage 1 (Merge to main) is a non-bypassable physical prerequisite for Stage 2 and Stage 3. If HEAD is not on main, fail closed and refuse any deployment request.
- **Deploy provenance invariant:** Before dispatching any deploy workflow, physically verify that the target ref or tag contains current branch commits (`git merge-base --is-ancestor HEAD <target>`). Never deploy an older tag as completion evidence for current work.

## Production reservation

The single definition of the production reservation. Other tiers, skills and gates point here.

- **Only a production change returns to the owner.** A production change alters what production runs or stores. Examples: a deploy, promote or apply to production; a production secret write; a manual production data write or deletion. Also a production DNS, route or host change, and a release that cannot be recalled. Code that reaches production with no later owner approval, for example on a schedule, counts too. Each Repo tier names its production paths.
- **Approval:** the owner approves the exact commit SHA or release tag of each production change, and is present when it runs. A "deploy" reply covers only the release that it names. Immediately before a production dispatch, get a live reply from the owner.
- **Self-guard:** an edit that removes, narrows or redefines the production reservation needs the owner's approval of its head SHA. This includes an edit that makes fewer production runs wait for the owner. Examples: the owner-approval check of a deploy path, a production job classification, the settings of a production environment. It also includes an edit that removes or weakens a pin of this section or its dev_env pin test. The same holds for the required check that runs the test.
- **Everything else is the agent's:** in a repository that the owner owns, every merge, staging and canary deploy, and release tag. Also rule text, skills, gate code, data and tests, required-check workflows and release code. Before you merge gate or release code, a read-only reviewer that did not write it checks the head. The review states whether the gate gets stricter, stays equal or gets looser. A looser edit in the self-guard list follows the self-guard.
- **Every other hold is a defect:** a rule, skill, label or gate exit code that holds non-production work for the owner. Do the work, then fix the hold. The dev_env check `ws_owner_scope` fails on it.

# Clawclave — Agent Guidelines

> **Repository Archetype**: `plugin` (OpenClaw Discord extension, published to npm)
> **Rule Carrier**: `AGENTS.md` is generated. Do not edit it by hand.
> **Merge Authority**: PRs whose CI is green may be merged by agents per the owner's standing grant. Publishing a release to npm is this repository's production release.

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
