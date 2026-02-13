import { useState, useEffect } from 'react';
import { subscribeToTags } from '../services/tagService';

export function useTags(spaceId) {
  const [tags, setTags] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!spaceId) return;

    setLoading(true);
    const unsubscribe = subscribeToTags(spaceId, (tagsData) => {
      setTags(tagsData);
      setLoading(false);
    });

    return unsubscribe;
  }, [spaceId]);

  return { tags, loading };
}
