const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { google } = require('googleapis');

// Define secrets
const googleClientId = defineSecret('GOOGLE_CLIENT_ID');
const googleClientSecret = defineSecret('GOOGLE_CLIENT_SECRET');

// Config (not secret)
const REDIRECT_URI = 'https://app.slips.dev/auth/callback';
const APP_URL = 'https://app.slips.dev';

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly'
];

function getOAuth2Client() {
  return new google.auth.OAuth2(
    googleClientId.value(),
    googleClientSecret.value(),
    REDIRECT_URI
  );
}

/**
 * Initiates Google Calendar OAuth flow
 * Returns the OAuth URL for the client to redirect to
 */
const initiateCalendarAuth = onCall({ secrets: [googleClientId, googleClientSecret] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const userId = request.auth.uid;
  const db = getFirestore();
  const oauth2Client = getOAuth2Client();

  // Generate a state token for CSRF protection
  const stateToken = Buffer.from(JSON.stringify({
    userId,
    timestamp: Date.now()
  })).toString('base64');

  // Store state token temporarily for validation
  await db.collection('calendarAuthStates').doc(stateToken).set({
    userId,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
  });

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state: stateToken,
    prompt: 'consent' // Force consent to always get refresh token
  });

  return { authUrl };
});

/**
 * Handles the OAuth callback from Google
 * Exchanges code for tokens and stores the connection
 */
const handleCalendarCallback = onRequest({ secrets: [googleClientId, googleClientSecret] }, async (req, res) => {
  const { code, state, error } = req.query;
  const db = getFirestore();

  // Handle OAuth errors
  if (error) {
    console.error('OAuth error:', error);
    return res.redirect(`${APP_URL}/?calendar=error&message=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return res.redirect(`${APP_URL}/?calendar=error&message=missing_params`);
  }

  try {
    // Validate state token
    const stateDoc = await db.collection('calendarAuthStates').doc(state).get();

    if (!stateDoc.exists) {
      return res.redirect(`${APP_URL}/?calendar=error&message=invalid_state`);
    }

    const stateData = stateDoc.data();
    const userId = stateData.userId;

    // Check if state token is expired
    if (stateData.expiresAt.toDate() < new Date()) {
      await db.collection('calendarAuthStates').doc(state).delete();
      return res.redirect(`${APP_URL}/?calendar=error&message=expired_state`);
    }

    // Delete state token (one-time use)
    await db.collection('calendarAuthStates').doc(state).delete();

    // Exchange code for tokens
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info from id_token
    const idToken = tokens.id_token;
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
    const providerAccountId = payload.email;
    const providerAccountName = payload.name || payload.email;

    // Get calendar list
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const calendarList = await calendar.calendarList.list();

    const calendars = calendarList.data.items.map(cal => ({
      calendarId: cal.id,
      name: cal.summary,
      color: cal.backgroundColor || '#4285f4',
      enabled: cal.primary || false,
      isPrimary: cal.primary || false
    }));

    // Create connection document ID
    const connectionId = `${userId}_google_${providerAccountId.replace(/[^a-zA-Z0-9]/g, '_')}`;

    // Store tokens (server-only collection)
    await db.collection('calendarTokens').doc(connectionId).set({
      userId,
      provider: 'google',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      updatedAt: FieldValue.serverTimestamp()
    });

    // Store connection (client-readable)
    await db.collection('calendarConnections').doc(connectionId).set({
      userId,
      provider: 'google',
      providerAccountId,
      providerAccountName,
      status: 'active',
      connectedAt: FieldValue.serverTimestamp(),
      calendars,
      grantedScopes: SCOPES
    });

    return res.redirect(`${APP_URL}/?calendar=connected`);
  } catch (err) {
    console.error('Callback error:', err);
    console.error('Callback error:', err.message);
    return res.redirect(`${APP_URL}/?calendar=error&message=callback_failed`);
  }
});

/**
 * Disconnects a calendar connection
 * Revokes tokens and deletes the connection
 */
const disconnectCalendar = onCall({ secrets: [googleClientId, googleClientSecret] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const userId = request.auth.uid;
  const { connectionId } = request.data;

  if (!connectionId) {
    throw new HttpsError('invalid-argument', 'Connection ID is required');
  }

  const db = getFirestore();

  // Verify the connection belongs to this user
  const connectionDoc = await db.collection('calendarConnections').doc(connectionId).get();

  if (!connectionDoc.exists) {
    throw new HttpsError('not-found', 'Connection not found');
  }

  if (connectionDoc.data().userId !== userId) {
    throw new HttpsError('permission-denied', 'Not authorized to disconnect this calendar');
  }

  // Get tokens to revoke
  const tokenDoc = await db.collection('calendarTokens').doc(connectionId).get();

  if (tokenDoc.exists) {
    const tokenData = tokenDoc.data();

    // Try to revoke the token with Google
    try {
      const oauth2Client = getOAuth2Client();
      if (tokenData.accessToken) {
        await oauth2Client.revokeToken(tokenData.accessToken);
      }
    } catch (err) {
      // Token revocation can fail if already expired/revoked - that's OK
      console.warn('Token revocation warning:', err.message);
    }

    // Delete token document
    await db.collection('calendarTokens').doc(connectionId).delete();
  }

  // Delete connection document
  await db.collection('calendarConnections').doc(connectionId).delete();

  return { success: true };
});

module.exports = {
  initiateCalendarAuth,
  handleCalendarCallback,
  disconnectCalendar
};
