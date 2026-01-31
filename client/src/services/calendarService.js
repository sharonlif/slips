import { httpsCallable } from 'firebase/functions';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { functions, db } from '../firebase';

/**
 * Initiates Google Calendar OAuth flow
 * Redirects user to Google consent screen
 */
export async function connectGoogleCalendar() {
  const initiateAuth = httpsCallable(functions, 'initiateCalendarAuth');
  const result = await initiateAuth();

  // Redirect to Google OAuth
  window.location.href = result.data.authUrl;
}

/**
 * Subscribes to calendar connections for a user
 * @param {string} userId - The user's ID
 * @param {function} callback - Called with array of connections
 * @returns {function} Unsubscribe function
 */
export function subscribeToCalendarConnections(userId, callback) {
  const q = query(
    collection(db, 'calendarConnections'),
    where('userId', '==', userId)
  );

  return onSnapshot(q, (snapshot) => {
    const connections = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    callback(connections);
  });
}

/**
 * Disconnects a calendar connection
 * @param {string} connectionId - The connection document ID
 */
export async function disconnectCalendar(connectionId) {
  const disconnect = httpsCallable(functions, 'disconnectCalendar');
  await disconnect({ connectionId });
}
