import { useState, useEffect, useRef, useCallback, forwardRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TimestampedParagraph } from '../editor/TimestampedParagraph';
import TimestampPlugin from '../editor/TimestampPlugin';
import { prepareContent } from '../editor/contentMigration';
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
  const [saving, setSaving] = useState(false);
  const saveTimeoutRef = useRef(null);
  const pendingContentRef = useRef(null);
  const isSavingRef = useRef(false);
  const lastSavedRef = useRef(content);
  const containerRef = useRef(null);
  const isExternalUpdate = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        paragraph: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        heading: false,
        horizontalRule: false,
      }),
      TimestampedParagraph,
      TimestampPlugin,
      Placeholder.configure({
        placeholder: '',
      }),
    ],
    content: prepareContent(content),
    editorProps: {
      attributes: {
        class: 'day-note-editor',
      },
      handleKeyDown(view, event) {
        if (event.key === 'Tab') {
          event.preventDefault();
          view.dispatch(view.state.tr.insertText('\t'));
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      if (isExternalUpdate.current) return;

      const json = editor.getJSON();

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        saveNote(json);
      }, 500);
    },
  });

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

  useEffect(() => {
    if (!spaceId || !editor) return;

    const unsubscribe = subscribeToNote(spaceId, date, (data) => {
      const remoteContent = data.content;
      if (!remoteContent) return;

      const remoteStr = JSON.stringify(remoteContent);
      const lastStr = JSON.stringify(lastSavedRef.current);

      if (remoteStr !== lastStr) {
        isExternalUpdate.current = true;
        const prepared = prepareContent(remoteContent);
        editor.commands.setContent(prepared);
        lastSavedRef.current = remoteContent;
        onContentChange(remoteContent);
        isExternalUpdate.current = false;
      }
    });

    return unsubscribe;
  }, [spaceId, date, editor, onContentChange]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const setRefs = useCallback((node) => {
    containerRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
  }, [ref]);

  return (
    <div className="day-note" ref={setRefs}>
      <div className="day-note-header">
        {saving && <span className="saving-indicator">saving...</span>}
        <h2 className="day-note-date">{formatDisplayDate(date)}</h2>
      </div>
      <div className="day-note-paper">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});
