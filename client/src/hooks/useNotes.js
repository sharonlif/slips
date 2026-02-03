import { useState, useEffect, useCallback } from 'react';
import { getNotes } from '../services/noteService';

const DAYS_PER_PAGE = 10;
const FUTURE_DAYS = 7;

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
  const [loadingFuture, setLoadingFuture] = useState(false);

  // Load initial notes: past dates (oldest first) -> today -> future dates
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

  // Load more past dates (prepend to list)
  const loadMorePast = useCallback(async () => {
    if (!spaceId || loadingMore || dates.length === 0) return;

    setLoadingMore(true);

    const oldestDate = dates[0];
    const oldestDateObj = new Date(oldestDate + 'T00:00:00');
    oldestDateObj.setDate(oldestDateObj.getDate() - 1);

    const moreDates = generateDateRange(oldestDateObj, DAYS_PER_PAGE, 'past').reverse();

    if (moreDates.length === 0) {
      setLoadingMore(false);
      return;
    }

    const fetchedNotes = await getNotes(spaceId, moreDates);

    setDates(prev => [...moreDates, ...prev]);
    setNotes(prev => ({ ...prev, ...fetchedNotes }));
    setLoadingMore(false);
  }, [spaceId, dates, loadingMore]);

  // Load more future dates (append to list)
  const loadMoreFuture = useCallback(async () => {
    if (!spaceId || loadingFuture || dates.length === 0) return;

    setLoadingFuture(true);

    const newestDate = dates[dates.length - 1];
    const newestDateObj = new Date(newestDate + 'T00:00:00');
    newestDateObj.setDate(newestDateObj.getDate() + 1);

    const moreDates = generateDateRange(newestDateObj, DAYS_PER_PAGE, 'future');

    if (moreDates.length === 0) {
      setLoadingFuture(false);
      return;
    }

    const fetchedNotes = await getNotes(spaceId, moreDates);

    setDates(prev => [...prev, ...moreDates]);
    setNotes(prev => ({ ...prev, ...fetchedNotes }));
    setLoadingFuture(false);
  }, [spaceId, dates, loadingFuture]);

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
    loadingFuture,
    loadMorePast,
    loadMoreFuture,
    updateNoteLocal
  };
}
