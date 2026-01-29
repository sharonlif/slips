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

  // Load initial notes: past dates (oldest first) -> today -> future dates
  // Scrolling down goes to future
  useEffect(() => {
    if (!spaceId) return;

    async function loadInitialNotes() {
      setLoading(true);

      const today = new Date();

      // Generate past dates (oldest first): start from today, go back, then reverse
      const pastDates = generateDateRange(today, DAYS_PER_PAGE - FUTURE_DAYS, 'past').reverse();

      // Generate future dates (starting from tomorrow, going forward)
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const futureDates = generateDateRange(tomorrow, FUTURE_DAYS, 'future');

      // Order: oldest past -> today (last of pastDates) -> future
      const allDates = [...pastDates, ...futureDates];

      setDates(allDates);

      const fetchedNotes = await getNotes(spaceId, allDates);
      setNotes(fetchedNotes);

      setLoading(false);
    }

    loadInitialNotes();
  }, [spaceId]);

  // Load more notes (older dates - prepend to list)
  const loadMore = useCallback(async () => {
    if (!spaceId || loadingMore || !hasMore || dates.length === 0) return;

    setLoadingMore(true);

    // Get the oldest date in current list and continue going back
    const oldestDate = dates[0];
    const oldestDateObj = new Date(oldestDate + 'T00:00:00');
    oldestDateObj.setDate(oldestDateObj.getDate() - 1);

    const moreDates = generateDateRange(oldestDateObj, DAYS_PER_PAGE, 'past').reverse();

    if (moreDates.length === 0) {
      setHasMore(false);
      setLoadingMore(false);
      return;
    }

    const fetchedNotes = await getNotes(spaceId, moreDates);

    setDates(prev => [...moreDates, ...prev]);
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
