import { useState, useEffect, useCallback } from 'react';
import { getNotes } from '../services/noteService';

const DAYS_PER_PAGE = 30;
const FUTURE_DAYS = 7; // Show 7 days into the future

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function generateDateRange(startDate, days, direction = 'past') {
  const dates = [];
  const current = new Date(startDate);

  for (let i = 0; i < days; i++) {
    dates.push(formatDate(current));
    if (direction === 'past') {
      current.setDate(current.getDate() - 1);
    } else {
      current.setDate(current.getDate() + 1);
    }
  }

  return dates;
}

export function useNotes(spaceId) {
  const [notes, setNotes] = useState({});
  const [dates, setDates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Load initial notes (future days + some past days)
  useEffect(() => {
    if (!spaceId) return;

    async function loadInitialNotes() {
      setLoading(true);

      const today = new Date();

      // Generate future dates (going forward from today)
      const futureStart = new Date(today);
      futureStart.setDate(futureStart.getDate() + FUTURE_DAYS);
      const futureDates = generateDateRange(futureStart, FUTURE_DAYS, 'past');

      // Generate past dates (going backward from yesterday)
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const pastDates = generateDateRange(yesterday, DAYS_PER_PAGE - FUTURE_DAYS, 'past');

      // Combine: future dates (newest first) + today + past dates
      const allDates = [...futureDates, ...pastDates];

      setDates(allDates);

      const fetchedNotes = await getNotes(spaceId, allDates);
      setNotes(fetchedNotes);

      setLoading(false);
    }

    loadInitialNotes();
  }, [spaceId]);

  // Load more notes (older dates)
  const loadMore = useCallback(async () => {
    if (!spaceId || loadingMore || !hasMore || dates.length === 0) return;

    setLoadingMore(true);

    // Get the oldest date in current list and continue from there
    const oldestDate = dates[dates.length - 1];
    const oldestDateObj = new Date(oldestDate + 'T00:00:00');
    oldestDateObj.setDate(oldestDateObj.getDate() - 1);

    const moreDates = generateDateRange(oldestDateObj, DAYS_PER_PAGE, 'past');

    if (moreDates.length === 0) {
      setHasMore(false);
      setLoadingMore(false);
      return;
    }

    const fetchedNotes = await getNotes(spaceId, moreDates);

    setDates(prev => [...prev, ...moreDates]);
    setNotes(prev => ({ ...prev, ...fetchedNotes }));
    setLoadingMore(false);
  }, [spaceId, dates, loadingMore, hasMore]);

  // Update a single note locally
  const updateNoteLocal = useCallback((date, content) => {
    setNotes(prev => ({
      ...prev,
      [date]: { ...prev[date], content }
    }));
  }, []);

  return {
    notes,
    dates,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    updateNoteLocal
  };
}
