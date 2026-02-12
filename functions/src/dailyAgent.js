const { onTaskDispatched } = require('firebase-functions/v2/tasks');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { getFunctions } = require('firebase-admin/functions');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const geminiApiKey = defineSecret('GEMINI_API_KEY');
const agentSecret = defineSecret('AGENT_API_SECRET');

/**
 * Core agent logic: processes a single user's daily summary.
 * Shared by processDaily (task queue) and runDailyAgent (HTTP).
 */
async function runAgentForUser(userId, spaceId, targetDate, apiKey) {
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
    return { skipped: true, reason: 'already processed' };
  }

  // Step 2: Read today's note
  const noteRef = db.collection('spaces').doc(spaceId).collection('notes').doc(targetDate);
  const noteSnap = await noteRef.get();
  const noteContent = noteSnap.exists ? noteSnap.data().content : '';

  // If no note content and no open tasks, nothing to do
  if (!noteContent && context.openTasks.length === 0) {
    console.log(`No note and no open tasks for ${targetDate}, space ${spaceId}. Skipping.`);
    await contextRef.set({
      ...context,
      lastSummarizedDate: targetDate,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { skipped: true, reason: 'no note and no open tasks' };
  }

  // Step 3: Call Gemini
  const genAI = new GoogleGenerativeAI(apiKey);
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

  for (const taskText of (parsed.newTasks || [])) {
    updatedOpenTasks.push({ text: taskText, extractedFrom: targetDate });
  }

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
  return { success: true, summary: parsed.summary, openTasks: updatedOpenTasks.length, tomorrowDate };
}

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
    await runAgentForUser(userId, spaceId, targetDate, geminiApiKey.value());
  }
);

/**
 * HTTP endpoint to manually trigger the agent for a specific user.
 * Usage: curl -X POST <url> -H "Content-Type: application/json" \
 *   -d '{"userId":"...","spaceId":"...","targetDate":"2026-02-12"}'
 */
const runDailyAgent = onRequest({ secrets: [geminiApiKey, agentSecret] }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  // Verify secret token
  const authHeader = req.headers['x-agent-secret'];
  if (!authHeader || authHeader !== agentSecret.value()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { userId, spaceId, targetDate } = req.body;

  if (!userId || !spaceId || !targetDate) {
    res.status(400).json({ error: 'Missing required fields: userId, spaceId, targetDate' });
    return;
  }

  try {
    const result = await runAgentForUser(userId, spaceId, targetDate, geminiApiKey.value());
    res.status(200).json(result);
  } catch (err) {
    console.error('runDailyAgent error:', err);
    res.status(500).json({ error: err.message });
  }
});

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

  // Query users in matching timezones (Firestore 'in' supports up to 30 per batch)
  const userDocs = [];
  for (let i = 0; i < matchingTimezones.length; i += 30) {
    const batch = matchingTimezones.slice(i, i + 30);
    const snap = await db.collection('users')
      .where('timezone', 'in', batch)
      .get();
    snap.docs.forEach(d => userDocs.push(d));
  }

  if (userDocs.length === 0) {
    console.log('No users in matching timezones.');
    return;
  }

  const queue = getFunctions().taskQueue('processDaily');

  for (const userDoc of userDocs) {
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

module.exports = { processDaily, triggerDailyAgent, runDailyAgent };
