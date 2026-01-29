import { useState, useEffect, useRef, useCallback } from 'react';
import { updateNote } from '../services/noteService';
import './DayNote.css';

function formatDisplayDate(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const noteDate = new Date(dateString + 'T00:00:00');

  if (noteDate.getTime() === today.getTime()) {
    return 'Today';
  } else if (noteDate.getTime() === tomorrow.getTime()) {
    return 'Tomorrow';
  } else if (noteDate.getTime() === yesterday.getTime()) {
    return 'Yesterday';
  }

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
  });
}

export function DayNote({ date, content, spaceId, onContentChange }) {
  const [localContent, setLocalContent] = useState(content);
  const [saving, setSaving] = useState(false);

  const saveTimeoutRef = useRef(null);
  const pendingContentRef = useRef(null);
  const isSavingRef = useRef(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    setLocalContent(content);
  }, [content]);

  const saveNote = useCallback(async (contentToSave) => {
    if (!spaceId || isSavingRef.current) {
      // If already saving, store as pending
      pendingContentRef.current = contentToSave;
      return;
    }

    isSavingRef.current = true;
    setSaving(true);

    try {
      await updateNote(spaceId, date, contentToSave);
      onContentChange(contentToSave);
    } catch (err) {
      console.error('Error saving note:', err);
    } finally {
      isSavingRef.current = false;

      // Check if there's pending content to save
      if (pendingContentRef.current !== null) {
        const pending = pendingContentRef.current;
        pendingContentRef.current = null;
        // Save the pending content
        saveNote(pending);
      } else {
        setSaving(false);
      }
    }
  }, [spaceId, date, onContentChange]);

  function handleChange(e) {
    const newContent = e.target.value;
    setLocalContent(newContent);

    // Clear any existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce: only save after 500ms of no typing
    saveTimeoutRef.current = setTimeout(() => {
      saveNote(newContent);
    }, 500);
  }

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="day-note">
      <div className="day-note-header">
        {saving && <span className="saving-indicator">saving...</span>}
        <h2 className="day-note-date">{formatDisplayDate(date)}</h2>
      </div>
      <div className="day-note-paper">
        <textarea
          ref={textareaRef}
          className="day-note-textarea"
          value={localContent}
          onChange={handleChange}
          placeholder=""
        />
      </div>
    </div>
  );
}
