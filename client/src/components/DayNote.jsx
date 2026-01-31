import { useState, useEffect, useRef, useCallback, forwardRef } from 'react';
import { updateNote, subscribeToNote } from '../services/noteService';
import './DayNote.css';

function formatDisplayDate(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  const today = new Date();

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
  });
}

export const DayNote = forwardRef(function DayNote({ date, content, spaceId, onContentChange }, ref) {
  const [localContent, setLocalContent] = useState(content);
  const [saving, setSaving] = useState(false);

  const saveTimeoutRef = useRef(null);
  const pendingContentRef = useRef(null);
  const isSavingRef = useRef(false);
  const textareaRef = useRef(null);
  const lastSavedRef = useRef(content);

  useEffect(() => {
    // Only sync if content differs from what we last saved (i.e., external change from another device)
    if (content !== lastSavedRef.current) {
      setLocalContent(content);
      lastSavedRef.current = content;
    }
  }, [content]);

  // Subscribe to real-time updates from Firestore
  useEffect(() => {
    if (!spaceId) return;

    const unsubscribe = subscribeToNote(spaceId, date, (data) => {
      const remoteContent = data.content || '';
      // Only update if content differs from what we last saved (external change)
      if (remoteContent !== lastSavedRef.current) {
        setLocalContent(remoteContent);
        lastSavedRef.current = remoteContent;
        onContentChange(remoteContent);
      }
    });

    return unsubscribe;
  }, [spaceId, date, onContentChange]);

  const saveNote = useCallback(async (contentToSave) => {
    if (!spaceId || isSavingRef.current) {
      pendingContentRef.current = contentToSave;
      return;
    }

    isSavingRef.current = true;
    setSaving(true);

    try {
      await updateNote(spaceId, date, contentToSave);
      lastSavedRef.current = contentToSave;
      onContentChange(contentToSave);
    } catch (err) {
      console.error('Error saving note:', err);
    } finally {
      isSavingRef.current = false;

      if (pendingContentRef.current !== null) {
        const pending = pendingContentRef.current;
        pendingContentRef.current = null;
        saveNote(pending);
      } else {
        setSaving(false);
      }
    }
  }, [spaceId, date, onContentChange]);

  function handleChange(e) {
    const newContent = e.target.value;
    setLocalContent(newContent);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveNote(newContent);
    }, 500);
  }

  function handleKeyDown(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.target;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = localContent.substring(0, start) + '\t' + localContent.substring(end);
      setLocalContent(newContent);

      // Restore cursor position after the tab
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 1;
      });

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        saveNote(newContent);
      }, 500);
    }
  }

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="day-note" ref={ref}>
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
          onKeyDown={handleKeyDown}
          placeholder=""
        />
      </div>
    </div>
  );
});
