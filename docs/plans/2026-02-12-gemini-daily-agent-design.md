# Gemini Daily Agent — Design Document

## Overview

A backend agent that runs nightly at 22:00 (per user timezone) to summarize the day's notes, maintain a rolling context of open tasks, and prepend tomorrow's task list into the next day's note.

**Approach:** Direct Gemini SDK (`@google/generative-ai`) + Firebase Cloud Tasks for per-user scheduling.

## Data Model

### New collection: `agentContext/{spaceId}` (server-only)

```
{
  lastSummarizedDate: "2026-02-11",
  openTasks: [
    { text: "Follow up with Dave on API spec", extractedFrom: "2026-02-10" },
    { text: "Fix login redirect bug", extractedFrom: "2026-02-11" }
  ],
  recentSummaries: [
    { date: "2026-02-11", summary: "Worked on auth flow..." },
    { date: "2026-02-10", summary: "Met with team about..." }
  ],
  updatedAt: Timestamp
}
```

- `openTasks`: Rolling list of unresolved tasks. Items are removed when Gemini detects the user marked them done.
- `recentSummaries`: Last 7 days of TL;DR summaries, used as LLM context. Oldest dropped when new one added.
- `lastSummarizedDate`: Prevents double-processing.

### Updated: `users/{userId}` — add `timezone` field

```
{
  email: "...",
  timezone: "Asia/Jerusalem",
  createdAt: Timestamp
}
```

Auto-detected on client via `Intl.DateTimeFormat().resolvedOptions().timeZone` and saved on every login.

### Firestore rules

`agentContext` is server-only:
```
match /agentContext/{spaceId} {
  allow read, write: if false;
}
```

## Scheduling

1. **Cloud Scheduler** fires a Pub/Sub message every hour (at :00).
2. Firebase Function `triggerDailyAgent` receives the message.
3. Calculates which IANA timezones are currently at 22:00.
4. Queries `users` collection for matching `timezone` values.
5. For each user, looks up their space via `memberships` collection.
6. Enqueues a **Cloud Task** per user-space pair with payload:
   ```json
   { "userId": "abc123", "spaceId": "space456", "targetDate": "2026-02-12" }
   ```

Cloud Tasks provide automatic retry (up to 3 attempts) if processing fails.

## Agent Logic (`processDaily` task queue function)

### Step 1: Gather inputs
- Read today's note: `spaces/{spaceId}/notes/{targetDate}`
- Read agent context: `agentContext/{spaceId}`

### Step 2: Call Gemini
Single prompt including:
- Today's note content
- Current open tasks
- Recent summaries (last 7 days)

Gemini returns structured JSON:
```json
{
  "summary": "Short TL;DR of today",
  "completedTasks": ["Fix login redirect bug"],
  "newTasks": ["Review PR from Dave", "Update API docs"],
  "tomorrowNote": "## Tasks for tomorrow\n- [ ] Review PR from Dave\n- [ ] Update API docs\n- [ ] Follow up with Dave on API spec"
}
```

### Step 3: Update context
- Remove `completedTasks` from `openTasks`
- Add `newTasks` to `openTasks` (with `extractedFrom: targetDate`)
- Push today's summary into `recentSummaries` (cap at 7)
- Update `lastSummarizedDate` and `updatedAt`
- Write to `agentContext/{spaceId}`

### Step 4: Write tomorrow's note
- Read tomorrow's note (may have existing content)
- Prepend generated task list to existing content
- Write back to `spaces/{spaceId}/notes/{tomorrowDate}`

### Edge cases
- **Empty note today**: Skip summarization, carry forward existing open tasks unchanged.
- **User already wrote in tomorrow's note**: Prepend tasks, preserve existing content.
- **Gemini returns malformed JSON**: Cloud Tasks auto-retries (up to 3 attempts).
- **Already processed today** (`lastSummarizedDate == targetDate`): Skip.

## Client-Side Changes

Minimal — timezone detection only:
- On login/app load, detect timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone`
- Save to `users/{uid}.timezone`
- Runs every login so it stays current if user travels

No new UI, no settings, no opt-in. Agent runs for all users.

## New Dependencies

- `@google/generative-ai` in `functions/package.json` (Gemini SDK)

## Architecture Diagram

```
Cloud Scheduler (hourly)
        │
        ▼
triggerDailyAgent (Pub/Sub function)
        │
        ├─ Query users by timezone
        ├─ Lookup spaces via memberships
        │
        ▼
Cloud Task queue (one per user-space)
        │
        ▼
processDaily (task queue function)
        │
        ├─ Read today's note
        ├─ Read agentContext
        ├─ Call Gemini API
        ├─ Update agentContext
        └─ Prepend tasks to tomorrow's note
```
