import { useState, useEffect } from 'react';
import { getUserPersonalSpace } from '../services/spaceService';

export function useSpace(userId) {
  const [space, setSpace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    async function fetchSpace() {
      try {
        setLoading(true);
        const personalSpace = await getUserPersonalSpace(userId);
        setSpace(personalSpace);
      } catch (err) {
        console.error('Error fetching space:', err);
        setError(err);
      } finally {
        setLoading(false);
      }
    }

    fetchSpace();
  }, [userId]);

  return { space, loading, error };
}
