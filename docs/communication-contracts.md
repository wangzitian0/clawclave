# Communication Contracts

This document defines success contracts for host-led Discord group work. A flow
is not successful until the expected visible artifact is delivered and state is
closed or explicitly marked partial/failed.

## Shared Rules

- Canonical state: `workspace/groups/discussions/active/*.json`.
- Archive state: `workspace/groups/discussions/archive/YYYY-MM/*.json`.
- Event log: `workspace/groups/discussions/events/YYYY-MM.jsonl`.
- Never write hosted-flow state under an agent-private workspace.
- The host owns protocol, pacing, visible hosting, reminders, and closeout.
- Expert agents own substance.
- Runtime or host code must record delivery facts; do not rely on an agent
  saying delivery happened.
- Visible Discord output should be natural and short; structured state stays in
  files.

## Participation Event

Typical intent: contest, vote, round, game, ranking, or everyone-answer prompt.

Success signal:

- The human sees a lively event, not a configuration dump.
- Each invited participant either posts one visible entry or is marked failed,
  timed out, or skipped.
- The host closes with participation count, highlights, decision when relevant,
  and any missing participants.

State contract:

- `workType`: `participation`
- `surface`: `channel` or `thread`
- `collaboration`: usually `parallel`; `sequential` only when order matters
- `successCriteria.kind`: `participation-event`
- `successCriteria.requiredVisibleArtifact`: `host-summary`
- `delivery.required`: `message_tool`
- `delivery.visibleMessageRequired`: `true`

## Hosted Discussion

Typical intent: compare viewpoints, organize expert reasoning, or turn a broad
question into a decision.

Success signal:

- Experts contribute distinct useful points.
- The host closes with synthesis, decision, or next action.

State contract:

- `workType`: `discussion`
- `surface`: `channel` or `thread`
- `collaboration`: `single-owner | sequential | parallel`
- `successCriteria.kind`: `hosted-discussion`
- `successCriteria.requiredVisibleArtifact`: `synthesis`
- `expectedOutput` names synthesis, decision, summary, or next action

## Research / Evidence Work

Typical intent: search, verify, investigate, compare, audit logs, or produce a
sourced answer.

Success signal:

- The human gets a conclusion with evidence, dates, source links or file/log
  references, uncertainty, and next action.
- Claims that change over time are verified against current or primary sources.

State contract:

- `workType`: `research`
- `surface`: usually `thread`
- `collaboration`: `single-owner` by default
- `successCriteria.kind`: `research-brief`
- `successCriteria.requiredVisibleArtifact`: `evidence-backed-answer`
- `evidence.required`: `true`
- `evidence.minimumSources`: default 2 for web/current claims; 1 for a single
  authoritative source or local log/file investigation
- `evidence.sourcePolicy`: `primary-preferred`

## New Group Onboarding

Success signal:

- A human confirms the group's purpose before durable context is written.
- The group goals file and standard group workspace files exist.
- Future messages in the channel load group context instead of unmapped fallback
  context.
