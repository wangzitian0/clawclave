# Group Interaction Taxonomy

Clawclave classifies Discord group interactions before a host agent chooses an
orchestration mechanism. The host account coordinates protocol; specialist
agents keep their own persona, skills, model choice, and judgment.

## Priority Order

Use the first matching class:

1. Human direct mention to a specific expert.
2. Operations, debugging, config, deployment, sync, cron, or production apply.
3. Detailed research, data checking, investigation, or evidence request.
4. Explicit request for the host to organize a discussion.
5. Explicit event, contest, vote, game, or everyone-answer request.
6. Ordinary single-question or casual message.
7. Low-value acknowledgement or noise that needs no action.

Do not upgrade a message into a bigger format just because the host can.

## Interaction Classes

### Direct Expert Mention

The mentioned expert should answer first. The host may acknowledge, record one
event, and later summarize or close. Active state is optional unless the host
converts the exchange into a broader flow.

### Operations Work

Use `workType=ops-change` for changes, deploys, syncs, config edits, and
production applies. Use `workType=diagnostic` for audit or root-cause work that
does not yet change state. Prefer a thread for long or noisy work.

### Hosted Discussion

Use when a human asks the host to organize viewpoints or reach a decision.
Choose `single-owner`, `sequential`, or `parallel`; create state before host-led
expert routing; close with synthesis, decision, or next action.

### Participation Event

Use for contests, votes, games, or everyone-answer prompts. The visible opener
should be natural and should not expose JSON/state details. Track participants,
delivery, deadline, reminders, and closeout in state.

### Research / Evidence Work

Use for web/current claims, log audits, data verification, and investigations.
Record the evidence standard before searching. Close with conclusion, evidence,
uncertainty, and next action.

### New Group Onboarding

For unmapped Discord channels, ask a human to confirm the group goal before
writing durable context. Do not start hosted flows in unmapped channels.

## State Fields

Use these fields to keep task type, location, and coordination separate:

- `workType`: `qa | discussion | research | ops-change | diagnostic | participation | scheduled | silent-record`
- `surface`: `channel | thread`
- `collaboration`: `none | single-owner | sequential | parallel`
- `successCriteria.kind`: `participation-event | hosted-discussion | research-brief`

Canonical state should live under `workspace/groups/discussions/**` in the host
repository.
