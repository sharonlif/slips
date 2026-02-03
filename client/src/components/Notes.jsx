import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { useSpace } from '../hooks/useSpace';
import { useNotes } from '../hooks/useNotes';
import { useCalendarConnections } from '../hooks/useCalendarConnections';
import { signOut } from '../services/authService';
import { connectGoogleCalendar, disconnectCalendar } from '../services/calendarService';
import { DayNote } from './DayNote';
import './Notes.css';

function getTodayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function Notes({ user }) {
  const { space, loading: spaceLoading } = useSpace(user.uid);
  const {
    notes,
    dates,
    loading: notesLoading,
    loadingMore,
    loadingFuture,
    loadMorePast,
    loadMoreFuture,
    updateNoteLocal
  } = useNotes(space?.id);
  const { connections: calendarConnections } = useCalendarConnections(user.uid);

  const [showMenu, setShowMenu] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [todayVisible, setTodayVisible] = useState(true);
  const [todayPosition, setTodayPosition] = useState('visible');
  const [initialScrollDone, setInitialScrollDone] = useState(false);
  const menuRef = useRef(null);
  const fabRef = useRef(null);
  const pastSentinelRef = useRef(null);
  const futureSentinelRef = useRef(null);
  const todayRef = useRef(null);
  const notesListRef = useRef(null);
  const scrollRestoreRef = useRef(null); // Stores scroll info before loading past dates
  const prevFirstDateRef = useRef(null); // Track first date to detect prepends

  const todayDate = getTodayDate();

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (
        showMenu &&
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        fabRef.current &&
        !fabRef.current.contains(e.target)
      ) {
        setShowMenu(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  // Track today's position relative to viewport
  useEffect(() => {
    function handleScroll() {
      if (!todayRef.current) return;

      const rect = todayRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      if (rect.top >= 0 && rect.top < viewportHeight) {
        setTodayPosition('visible');
        setTodayVisible(true);
      } else if (rect.top < 0) {
        setTodayPosition('above');
        setTodayVisible(false);
      } else {
        setTodayPosition('below');
        setTodayVisible(false);
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Callback ref for today's element
  const setTodayRef = useCallback((node) => {
    todayRef.current = node;

    if (node && !initialScrollDone) {
      node.scrollIntoView({ behavior: 'instant', block: 'start' });
      setInitialScrollDone(true);
    }
  }, [initialScrollDone]);

  // Wrap loadMorePast to save scroll position before loading
  const handleLoadMorePast = useCallback(() => {
    // Save current scroll height before new content is added
    scrollRestoreRef.current = {
      scrollHeight: document.documentElement.scrollHeight,
      scrollTop: window.scrollY
    };
    loadMorePast();
  }, [loadMorePast]);

  // Restore scroll position after past dates are prepended
  useLayoutEffect(() => {
    const firstDate = dates[0];

    // Detect if new dates were prepended (first date changed)
    if (prevFirstDateRef.current && firstDate !== prevFirstDateRef.current && scrollRestoreRef.current) {
      const { scrollHeight: prevScrollHeight, scrollTop: prevScrollTop } = scrollRestoreRef.current;
      const newScrollHeight = document.documentElement.scrollHeight;
      const heightDiff = newScrollHeight - prevScrollHeight;

      // Adjust scroll position by the height of newly added content
      window.scrollTo(0, prevScrollTop + heightDiff);
      scrollRestoreRef.current = null;
    }

    prevFirstDateRef.current = firstDate;
  }, [dates]);

  // Load more past dates when scrolling to top
  useEffect(() => {
    if (!pastSentinelRef.current || notesLoading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore) {
          handleLoadMorePast();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(pastSentinelRef.current);

    return () => observer.disconnect();
  }, [handleLoadMorePast, notesLoading, loadingMore]);

  // Load more future dates when scrolling to bottom
  useEffect(() => {
    if (!futureSentinelRef.current || notesLoading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingFuture) {
          loadMoreFuture();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(futureSentinelRef.current);

    return () => observer.disconnect();
  }, [loadMoreFuture, notesLoading, loadingFuture]);

  async function handleSignOut() {
    try {
      await signOut();
    } catch (err) {
      console.error('Sign out error:', err);
    }
  }

  async function handleConnectCalendar() {
    setCalendarLoading(true);
    setShowMenu(false);
    try {
      await connectGoogleCalendar();
    } catch (err) {
      console.error('Calendar connect error:', err);
      setCalendarLoading(false);
    }
  }

  async function handleDisconnectCalendar() {
    const connection = calendarConnections[0];
    if (!connection) return;

    setCalendarLoading(true);
    setShowMenu(false);
    try {
      await disconnectCalendar(connection.id);
    } catch (err) {
      console.error('Calendar disconnect error:', err);
    }
    setCalendarLoading(false);
  }

  const hasCalendarConnection = calendarConnections.length > 0;

  function scrollToToday() {
    if (todayRef.current) {
      todayRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  if (spaceLoading || notesLoading) {
    return (
      <div className="notes-loading">
        <span>Loading...</span>
      </div>
    );
  }

  const userInitial = user.displayName
    ? user.displayName.charAt(0).toUpperCase()
    : user.email.charAt(0).toUpperCase();

  return (
    <div className="notes-container">
      <main className="notes-list">
        {/* Sentinel for loading more past dates */}
        <div ref={pastSentinelRef} className="scroll-sentinel">
          {loadingMore && <span className="loading-more">Loading...</span>}
        </div>

        {dates.map((date) => (
          <DayNote
            key={date}
            ref={date === todayDate ? setTodayRef : null}
            date={date}
            content={notes[date]?.content || ''}
            spaceId={space?.id}
            onContentChange={(content) => updateNoteLocal(date, content)}
          />
        ))}

        {/* Sentinel for loading more future dates */}
        <div ref={futureSentinelRef} className="scroll-sentinel">
          {loadingFuture && <span className="loading-more">Loading...</span>}
        </div>
      </main>

      {/* User menu popup */}
      {showMenu && (
        <div ref={menuRef} className="user-menu">
          <div className="user-menu-email">{user.email}</div>
          {hasCalendarConnection ? (
            <button
              className="user-menu-btn user-menu-btn-calendar"
              onClick={handleDisconnectCalendar}
              disabled={calendarLoading}
            >
              <svg className="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              Disconnect Calendar
            </button>
          ) : (
            <button
              className="user-menu-btn user-menu-btn-calendar"
              onClick={handleConnectCalendar}
              disabled={calendarLoading}
            >
              <svg className="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              {calendarLoading ? 'Connecting...' : 'Connect Calendar'}
            </button>
          )}
          <button className="user-menu-btn" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      )}

      {/* Scroll to today button */}
      {!todayVisible && (
        <button className="today-fab" onClick={scrollToToday} title="Go to today">
          <svg viewBox="0 0 24 24" className={`today-arrow ${todayPosition === 'above' ? 'arrow-up' : 'arrow-down'}`}>
            <path d="M12 4l-8 8h5v8h6v-8h5z" fill="currentColor" />
          </svg>
        </button>
      )}

      {/* Floating user button */}
      <button
        ref={fabRef}
        className="user-fab"
        onClick={() => setShowMenu(!showMenu)}
      >
        {user.photoURL ? (
          <img src={user.photoURL} alt="" className="user-avatar" />
        ) : (
          <span className="user-initial">{userInitial}</span>
        )}
      </button>
    </div>
  );
}
