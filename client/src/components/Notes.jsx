import { useState, useEffect, useRef, useCallback } from 'react';
import { useSpace } from '../hooks/useSpace';
import { useNotes } from '../hooks/useNotes';
import { signOut } from '../services/authService';
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

  const [showMenu, setShowMenu] = useState(false);
  const [todayVisible, setTodayVisible] = useState(true);
  const [todayPosition, setTodayPosition] = useState('visible');
  const [initialScrollDone, setInitialScrollDone] = useState(false);
  const menuRef = useRef(null);
  const fabRef = useRef(null);
  const pastSentinelRef = useRef(null);
  const futureSentinelRef = useRef(null);
  const todayRef = useRef(null);

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

  // Load more past dates when scrolling to top
  useEffect(() => {
    if (!pastSentinelRef.current || notesLoading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore) {
          loadMorePast();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(pastSentinelRef.current);

    return () => observer.disconnect();
  }, [loadMorePast, notesLoading, loadingMore]);

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
