# Group Workspace Contract

Each Discord group can be treated as an organization with its own operating
context. Agent workspaces describe individual identity; group workspaces
describe group goals, norms, memory, and conversation record.

## Files

- `IDENTITY.md`: stable group purpose, channel id, goal, metrics, and owners.
- `SOUL.md`: organization personality, tone, and decision style.
- `USER.md`: stable human/user preferences for this group.
- `AGENTS.md`: group-specific routing rules and role expectations.
- `MEMORY.md`: reviewed long-term group memory and review outcomes.
- `HEARTBEAT.md`: review cadence and maintenance notes.
- `sessions/`: append-only group conversation binlog.

## Context Loading Rule

For a Discord group-channel run, the model should receive:

1. personal context from the target agent workspace;
2. organization context from `workspace/groups/<group-slug>/`;
3. a limited transcript tail or reviewed summary;
4. the current user message.

Recommended precedence:

```text
current user instruction > current thread/project state > current group goals > organization rules > agent personal identity/skills > long-term memory/style
```

## Audit Requirement

Runtime should make it possible to verify:

- group slug;
- Discord channel id;
- loaded group files;
- content hashes or revisions;
- transcript tail or summary source;
- whether group context was omitted and why.
