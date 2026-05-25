# Group Session Schema

Group sessions are append-only conversation binlogs for Discord channels. They
mirror agent sessions, but the owner is the organization/group rather than a
single agent.

## Directory Layout

```text
workspace/groups/<group-slug>/
  sessions/
    sessions.json
    <session-id>.jsonl
```

## `sessions.json`

Suggested key format:

```text
group:<group-slug>:discord:channel:<channel-id>
group:<group-slug>:discord:thread:<thread-id>
```

Suggested fields:

- `sessionId`
- `updatedAt`
- `sessionStartedAt`
- `lastInteractionAt`
- `displayName`
- `chatType`
- `channel`
- `groupSlug`
- `groupId`
- `groupChannel`
- `space`
- `sessionFile`
- `compactionCount`

## JSONL Event Types

Each line must be standalone JSON.

### `session`

Starts a group session file.

### `message`

Records a human, bot, or agent Discord message.

Required fields should include `messageId`, `channelId`, `authorType`,
`content`, and `direction`.

### `routing`

Records routing, gating, or orchestration facts for a Discord message.

### `custom_message`

Records secretary notes, manually reviewed annotations, or compact public notes.

### `review_note`

Records review evidence and metric observations.

### `compaction`

Records a durable summary of older binlog content.

## Sensitive Data Rules

- Do not write tokens, auth profile contents, device secrets, or credential file
  contents into group sessions.
- Attachment metadata is allowed; raw file contents should stay in the media
  store unless explicitly summarized.
- Keep human-sensitive context in reviewed group memory only after review.
