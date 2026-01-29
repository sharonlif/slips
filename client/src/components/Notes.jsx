import { useState, useEffect, useRef } from 'react';
import { useSpace } from '../hooks/useSpace';
import { useNotes } from '../hooks/useNotes';
import { signOut } from '../services/authService';
import { DayNote } from './DayNote';
import './Notes.css';

export function Notes({ user }) {
  const { space, loading: spaceLoading } = useSpace(user.uid);
  const {
    notes,
    dates,
    loading: notesLoading,
    loadingMore,
    hasMore,
    loadMore,
    updateNoteLocal
  } = useNotes(space?.id);

  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);
  const fabRef = useRef(null);
  const sentinelRef = useRef(null);

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

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    if (!sentinelRef.current || notesLoading || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore) {
          loadMore();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinelRef.current);

    return () => observer.disconnect();
  }, [loadMore, notesLoading, loadingMore, hasMore]);

  async function handleSignOut() {
    try {
      await signOut();
    } catch (err) {
      console.error('Sign out error:', err);
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
        {dates.map((date) => (
          <DayNote
            key={date}
            date={date}
            content={notes[date]?.content || ''}
            spaceId={space?.id}
            onContentChange={(content) => updateNoteLocal(date, content)}
          />
        ))}

        <div ref={sentinelRef} className="scroll-sentinel">
          {loadingMore && <span className="loading-more">Loading...</span>}
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
