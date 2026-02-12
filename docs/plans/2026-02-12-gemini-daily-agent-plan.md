# Gemini Daily Agent — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a nightly agent that summarizes daily notes via Gemini, tracks open tasks, and prepends tomorrow's task list into the next day's note.

**Architecture:** Firebase Cloud Functions with Cloud Scheduler (hourly Pub/Sub) → per-user timezone filtering → Cloud Tasks queue → Gemini API call → Firestore writes. Client-side only adds timezone detection on login.

**Tech Stack:** Firebase Functions v5 (Node 20), `@google/generative-ai` SDK, Firestore, Cloud Tasks, Cloud Scheduler.

---

### Task 1: Install Gemini SDK dependency

**Files:**
- Modify: `functions/package.json`

**Step 1: Install the dependency**

Run:
```bash
cd functions && npm install @google/generative-ai
```

**Step 2: Verify installation**

Run:
```bash
cd functions && node -e "require('@google/generative-ai'); console.log('OK')"
```
Expected: `OK`

**Step 3: Commit**

```bash
git add functions/package.json functions/package-lock.json
git commit -m "feat: add @google/generative-ai SDK dependency"
```

---

### Task 2: Add Firestore rules for agentContext

**Files:**
- Modify: `firestore.rules:39` (insert before the `isMember` helper function)

**Step 1: Add the rule**

Add this block after the `calendarAuthStates` rule (after line 38) and before the `isMember` helper:

```
    // Agent context - server-only, no client access
    match /agentContext/{contextId} {
      allow read, write: if false;
    }
```

**Step 2: Verify rules file is valid**

Run:
```bash
cd /Users/sharon/dev/slips && npx firebase-tools emulators:start --only firestore --dry-run 2>&1 | head -5
```

If `firebase-tools` isn't available locally, just visually confirm the rules parse correctly.

**Step 3: Commit**

```bash
git add firestore.rules
git commit -m "feat: add server-only Firestore rules for agentContext"
```

---

### Task 3: Save user timezone on login

**Files:**
- Modify: `client/src/services/authService.js:14-25` (the `handleUserFirstSignIn` function)

**Step 1: Update `handleUserFirstSignIn` to always save timezone**

Replace the `handleUserFirstSignIn` function with:

```js
async function handleUserFirstSignIn(user) {
  const userRef = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (!userSnap.exists()) {
    await setDoc(userRef, {
      email: user.email,
      timezone,
      createdAt: serverTimestamp()
    });
    await createPersonalSpace(user.uid);
  } else {
    // Update timezone on every login (handles travel)
    await setDoc(userRef, { timezone }, { merge: true });
  }
}
```

**Step 2: Commit**

```bash
git add client/src/services/authService.js
git commit -m "feat: detect and save user timezone on every login"
```

---

### Task 4: Create the `processDaily` agent function

This is the core AI logic. It reads the day's note, calls Gemini, updates context, and writes tomorrow's note.

**Files:**
- Create: `functions/src/dailyAgent.js`

**Step 1: Create the agent module**

Create `functions/src/dailyAgent.js` with the following content:

```js
const { onTaskDispatched } = require('firebase-functions/v2/tasks');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFunctions } = require('firebase-admin/functions');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const geminiApiKey = defineSecret('GEMINI_API_KEY');

/**
 * Task queue function: processes a single user's daily summary.
 * Called by triggerDailyAgent via Cloud Tasks.
 */
const processDaily = onTaskDispatched(
  {
    retryConfig: {
      maxAttempts: 3,
      minBackoffSeconds: 30,
    },
    rateLimits: {
      maxConcurrentDispatches: 10,
    },
    secrets: [geminiApiKey],
  },
  async (req) => {
    const { userId, spaceId, targetDate } = req.data;
    const db = getFirestore();

    // Step 1: Check if already processed
    const contextRef = db.collection('agentContext').doc(spaceId);
    const contextSnap = await contextRef.get();
    const context = contextSnap.exists ? contextSnap.data() : {
      lastSummarizedDate: null,
      openTasks: [],
      recentSummaries: [],
    };

    if (context.lastSummarizedDate === targetDate) {
      console.log(`Already processed ${targetDate} for space ${spaceId}, skipping.`);
      return;
    }

    // Step 2: Read today's note
    const noteRef = db.collection('spaces').doc(spaceId).collection('notes').doc(targetDate);
    const noteSnap = await noteRef.get();
    const noteContent = noteSnap.exists ? noteSnap.data().content : '';

    // If no note content and no open tasks, nothing to do
    if (!noteContent && context.openTasks.length === 0) {
      console.log(`No note and no open tasks for ${targetDate}, space ${spaceId}. Skipping.`);
      // Still update lastSummarizedDate so we don't re-check
      await contextRef.set({
        ...context,
        lastSummarizedDate: targetDate,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    // Step 3: Call Gemini
    const genAI = new GoogleGenerativeAI(geminiApiKey.value());
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = buildPrompt(noteContent, context.openTasks, context.recentSummaries, targetDate);

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const responseText = result.response.text();
    const parsed = JSON.parse(responseText);

    // Step 4: Update context
    const completedSet = new Set((parsed.completedTasks || []).map(t => t.toLowerCase().trim()));
    const updatedOpenTasks = context.openTasks.filter(
      (task) => !completedSet.has(task.text.toLowerCase().trim())
    );

    // Add new tasks
    for (const taskText of (parsed.newTasks || [])) {
      updatedOpenTasks.push({ text: taskText, extractedFrom: targetDate });
    }

    // Update recent summaries (keep last 7)
    const updatedSummaries = [
      { date: targetDate, summary: parsed.summary || '' },
      ...context.recentSummaries,
    ].slice(0, 7);

    await contextRef.set({
      lastSummarizedDate: targetDate,
      openTasks: updatedOpenTasks,
      recentSummaries: updatedSummaries,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Step 5: Write tomorrow's note
    const tomorrowDate = getNextDate(targetDate);
    const tomorrowNoteRef = db.collection('spaces').doc(spaceId).collection('notes').doc(tomorrowDate);
    const tomorrowSnap = await tomorrowNoteRef.get();
    const existingContent = tomorrowSnap.exists ? (tomorrowSnap.data().content || '') : '';

    const taskListText = parsed.tomorrowNote || formatTaskList(updatedOpenTasks);
    const newContent = existingContent
      ? `${taskListText}\n\n---\n\n${existingContent}`
      : taskListText;

    await tomorrowNoteRef.set({
      content: newContent,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`Processed ${targetDate} for space ${spaceId}. Tasks: ${updatedOpenTasks.length} open.`);
  }
);

/**
 * Scheduled function: runs every hour, finds users at 22:00 local time,
 * and enqueues a Cloud Task for each.
 */
const triggerDailyAgent = onSchedule('every 1 hours', async (event) => {
  const db = getFirestore();
  const now = new Date();

  // Find all IANA timezones where it's currently 22:xx
  const matchingTimezones = getTimezonesAtHour(now, 22);

  if (matchingTimezones.length === 0) {
    console.log('No timezones at 22:00 right now.');
    return;
  }

  console.log(`Timezones at 22:00: ${matchingTimezones.join(', ')}`);

  // Query users in matching timezones (Firestore 'in' supports up to 30)
  const usersSnap = await db.collection('users')
    .where('timezone', 'in', matchingTimezones.slice(0, 30))
    .get();

  if (usersSnap.empty) {
    console.log('No users in matching timezones.');
    return;
  }

  const queue = getFunctions().taskQueue('processDaily');

  for (const userDoc of usersSnap.docs) {
    const userId = userDoc.id;

    // Find user's space via memberships
    const membershipSnap = await db.collection('memberships')
      .where('userId', '==', userId)
      .where('role', '==', 'owner')
      .limit(1)
      .get();

    if (membershipSnap.empty) continue;

    const spaceId = membershipSnap.docs[0].data().spaceId;

    // Today's date in the user's timezone
    const targetDate = getDateInTimezone(now, userDoc.data().timezone);

    await queue.enqueue({
      userId,
      spaceId,
      targetDate,
    });

    console.log(`Enqueued task for user ${userId}, space ${spaceId}, date ${targetDate}`);
  }
});

// --- Helper functions ---

function buildPrompt(noteContent, openTasks, recentSummaries, targetDate) {
  const tasksText = openTasks.length > 0
    ? openTasks.map(t => `- ${t.text} (from ${t.extractedFrom})`).join('\n')
    : 'None';

  const summariesText = recentSummaries.length > 0
    ? recentSummaries.map(s => `**${s.date}:** ${s.summary}`).join('\n')
    : 'None';

  return `You are a personal productivity assistant. Analyze today's note and maintain a running task list.

## Today's date: ${targetDate}

## Today's note:
${noteContent || '(empty — no notes today)'}

## Currently open tasks:
${tasksText}

## Recent daily summaries (for context):
${summariesText}

## Instructions:
1. Write a short 1-3 sentence summary of today's note.
2. Identify any tasks from the open tasks list that the user has completed today (mentioned doing, finishing, or resolving them).
3. Extract any NEW tasks or action items from today's note that aren't already in the open tasks list.
4. Generate a formatted task list for tomorrow that includes all remaining open tasks plus new ones.

Respond with this exact JSON structure:
{
  "summary": "1-3 sentence TL;DR of today",
  "completedTasks": ["exact text of completed tasks from the open tasks list"],
  "newTasks": ["new action items extracted from today's note"],
  "tomorrowNote": "## Tasks\\n- [ ] task 1\\n- [ ] task 2\\n..."
}

Rules:
- Only mark a task as completed if the note clearly indicates it was done.
- For tomorrowNote, use markdown checkbox format: - [ ] task
- Keep tomorrowNote concise — just the task list, no extra commentary.
- If the note is empty, return empty summary, no completed tasks, no new tasks, and carry forward all open tasks in tomorrowNote.`;
}

function getNextDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

function getDateInTimezone(date, timezone) {
  return date.toLocaleDateString('en-CA', { timeZone: timezone });
  // en-CA gives YYYY-MM-DD format
}

function getTimezonesAtHour(now, targetHour) {
  // Common IANA timezones to check
  const allTimezones = Intl.supportedValuesOf('timeZone');
  return allTimezones.filter((tz) => {
    try {
      const hour = parseInt(
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hour: 'numeric',
          hour12: false,
        }).format(now)
      );
      return hour === targetHour;
    } catch {
      return false;
    }
  });
}

function formatTaskList(openTasks) {
  if (openTasks.length === 0) return '';
  const lines = openTasks.map(t => `- [ ] ${t.text}`);
  return `## Tasks\n${lines.join('\n')}`;
}

module.exports = { processDaily, triggerDailyAgent };
```

**Step 2: Verify it parses**

Run:
```bash
cd /Users/sharon/dev/slips/functions && node -e "require('./src/dailyAgent'); console.log('OK')"
```
Expected: `OK`

**Step 3: Commit**

```bash
git add functions/src/dailyAgent.js
git commit -m "feat: add processDaily and triggerDailyAgent functions for Gemini daily agent"
```

---

### Task 5: Export new functions in index.js

**Files:**
- Modify: `functions/index.js:11-15` (add exports after calendar auth exports)

**Step 1: Add exports**

Add the following after the existing calendar auth exports (after line 15):

```js
// Export daily agent functions
const {
  processDaily,
  triggerDailyAgent
} = require('./src/dailyAgent');

exports.processDaily = processDaily;
exports.triggerDailyAgent = triggerDailyAgent;
```

**Step 2: Verify the full index loads**

Run:
```bash
cd /Users/sharon/dev/slips/functions && node -e "require('./index.js'); console.log('OK')"
```
Expected: `OK`

**Step 3: Commit**

```bash
git add functions/index.js
git commit -m "feat: export processDaily and triggerDailyAgent from functions index"
```

---

### Task 6: Set the Gemini API key as a Firebase secret

**Step 1: Set the secret**

Run:
```bash
firebase functions:secrets:set GEMINI_API_KEY
```

This will prompt for the API key value. Get the key from https://aistudio.google.com/apikey.

**Step 2: Verify secret is set**

Run:
```bash
firebase functions:secrets:access GEMINI_API_KEY
```
Expected: prints the key value.

---

### Task 7: Deploy and verify

**Step 1: Deploy functions**

Run:
```bash
cd /Users/sharon/dev/slips && firebase deploy --only functions
```

**Step 2: Deploy Firestore rules**

Run:
```bash
cd /Users/sharon/dev/slips && firebase deploy --only firestore:rules
```

**Step 3: Deploy client (for timezone saving)**

Run:
```bash
cd /Users/sharon/dev/slips/client && npm run build && cd .. && firebase deploy --only hosting
```

**Step 4: Verify Cloud Scheduler job was created**

Check in Firebase Console → Cloud Scheduler that `triggerDailyAgent` shows as a scheduled job running every hour.

**Step 5: Test manually (optional)**

To test without waiting for 22:00, call `processDaily` directly via the Firebase console or enqueue a test task:

```bash
firebase functions:shell
> processDaily({data: {userId: "YOUR_UID", spaceId: "YOUR_SPACE_ID", targetDate: "2026-02-12"}})
```

**Step 6: Commit any remaining changes**

```bash
git add -A && git commit -m "chore: deploy Gemini daily agent"
```

---

### Task 8: Add Firestore index for timezone queries

The `triggerDailyAgent` function queries users by `timezone`. This may need a composite index if Firestore requires one.

**Files:**
- Modify: `firestore.indexes.json`

**Step 1: Check if the query works**

After deploying, if the Cloud Function logs show an index error, add the index:

```json
{
  "indexes": [],
  "fieldOverrides": []
}
```

The `timezone` query is a single-field `where('timezone', 'in', [...])` — this should work without a composite index since it's a single field query. Monitor logs after first run.

**Step 2: If needed, create index via CLI**

Run:
```bash
firebase firestore:indexes:create --collection-group users --field-path timezone
```

No commit needed unless the index file changes.
