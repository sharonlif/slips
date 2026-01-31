import { useState, useEffect } from 'react';
import { subscribeToCalendarConnections } from '../services/calendarService';

/**
 * Hook to subscribe to user's calendar connections
 * @param {string} userId - The user's ID
 * @returns {{ connections: Array, loading: boolean }}
 */
export function useCalendarConnections(userId) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setConnections([]);
      setLoading(false);
      return;
    }

    const unsubscribe = subscribeToCalendarConnections(userId, (conns) => {
      setConnections(conns);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [userId]);

  return { connections, loading };
}
