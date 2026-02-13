import { useState, useEffect, useRef, useCallback, forwardRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TimestampedParagraph } from '../editor/TimestampedParagraph';
import TimestampPlugin from '../editor/TimestampPlugin';
import { prepareContent } from '../editor/contentMigration';
import { updateNote, subscribeToNote } from '../services/noteService';
import { TagPicker } from './TagPicker';
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

function TagGutter({ editor, tags }) {
  const [gutterItems, setGutterItems] = useState([]);

  useEffect(() => {
    if (!editor) return;

    function updateGutter() {
      const items = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && node.attrs.tags?.length > 0) {
          const dom = editor.view.nodeDOM(pos);
          if (dom) {
            const editorDom = editor.view.dom;
            const rect = dom.getBoundingClientRect();
            const editorRect = editorDom.getBoundingClientRect();
            items.push({
              top: rect.top - editorRect.top,
              tags: node.attrs.tags,
            });
          }
        }
      });
      setGutterItems(items);
    }

    updateGutter();
    editor.on('update', updateGutter);
    editor.on('selectionUpdate', updateGutter);
    window.addEventListener('scroll', updateGutter, { passive: true });

    return () => {
      editor.off('update', updateGutter);
      editor.off('selectionUpdate', updateGutter);
      window.removeEventListener('scroll', updateGutter);
    };
  }, [editor]);

  return (
    <div className="tag-gutter">
      {gutterItems.map((item, i) => (
        <div key={i} className="tag-gutter-item" style={{ top: item.top }}>
          {item.tags.slice(0, 3).map((tagId) => (
            <span
              key={tagId}
              className="tag-gutter-dot"
              style={{ backgroundColor: tags[tagId]?.color || '#ccc' }}
              title={tags[tagId]?.name || tagId}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export const DayNote = forwardRef(function DayNote({ date, content, spaceId, tags, onContentChange }, ref) {
  const [saving, setSaving] = useState(false);
  const saveTimeoutRef = useRef(null);
  const pendingContentRef = useRef(null);
  const isSavingRef = useRef(false);
  const lastSavedRef = useRef(content);
  const containerRef = useRef(null);
  const isExternalUpdate = useRef(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [tagPickerPosition, setTagPickerPosition] = useState({ top: 0, left: 0 });

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
        if ((event.metaKey || event.ctrlKey) && event.key === '/') {
          event.preventDefault();
          const coords = view.coordsAtPos(view.state.selection.from);
          setTagPickerPosition({ top: coords.bottom + 4, left: coords.left });
          setShowTagPicker(true);
          return true;
        }
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

  function handleToggleTag(tagId) {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const { tr } = editor.state;
    editor.state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === 'paragraph') {
        const currentTags = [...(node.attrs.tags || [])];
        const idx = currentTags.indexOf(tagId);
        if (idx >= 0) {
          currentTags.splice(idx, 1);
        } else {
          currentTags.push(tagId);
        }
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, tags: currentTags });
      }
    });
    editor.view.dispatch(tr);
    // Trigger save after tag change
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => saveNote(editor.getJSON()), 500);
  }

  function getActiveTagsForSelection() {
    if (!editor) return [];
    const { from, to } = editor.state.selection;
    const tags = new Set();
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.type.name === 'paragraph' && node.attrs.tags) {
        node.attrs.tags.forEach(t => tags.add(t));
      }
    });
    return Array.from(tags);
  }

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
        <TagGutter editor={editor} tags={tags || {}} />
        <EditorContent editor={editor} />
        {showTagPicker && (
          <TagPicker
            tags={tags || {}}
            activeTags={getActiveTagsForSelection()}
            position={tagPickerPosition}
            spaceId={spaceId}
            onToggleTag={handleToggleTag}
            onClose={() => setShowTagPicker(false)}
          />
        )}
      </div>
    </div>
  );
});
