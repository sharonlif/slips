# Tags, Change Tracking & Context System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the editor from textarea to Tiptap, add per-paragraph timestamps and tagging, and build tag filtering UI — while keeping the notepad looking and feeling identical to the current simple editor.

**Architecture:** Replace the plain textarea with a Tiptap editor using a custom paragraph node that carries `id`, `createdAt`, `modifiedAt`, and `tags` attributes. Tags stored as a Firestore subcollection per space. Tag picker via Cmd+/ shortcut. Gutter on the left shows tag indicators. Two filter modes: in-place highlight and cross-day consolidated view.

**Tech Stack:** Tiptap (ProseMirror wrapper), React 19, Firebase Firestore, Vite

**Design doc:** `docs/plans/2026-02-12-tags-system-design.md`

---

### Task 1: Install Tiptap dependencies

**Files:**
- Modify: `client/package.json`

**Step 1: Install Tiptap packages**

```bash
cd /Users/sharon/dev/slips/client && npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-placeholder
```

**Step 2: Verify installation**

```bash
cd /Users/sharon/dev/slips/client && node -e "require('@tiptap/react'); console.log('OK')"
```
Expected: `OK` (or module resolution success)

**Step 3: Commit**

```bash
cd /Users/sharon/dev/slips && git add client/package.json client/package-lock.json
git commit -m "feat: add Tiptap editor dependencies"
```

---

### Task 2: Create custom paragraph extension with metadata attributes

**Files:**
- Create: `client/src/editor/TimestampedParagraph.js`

**Step 1: Create the custom paragraph extension**

Create `client/src/editor/TimestampedParagraph.js`:

```js
import { Node, mergeAttributes } from '@tiptap/core';

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

const TimestampedParagraph = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  priority: 1000,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-id'),
        renderHTML: (attributes) => {
          if (!attributes.id) return {};
          return { 'data-id': attributes.id };
        },
      },
      createdAt: {
        default: null,
        parseHTML: (element) => {
          const val = element.getAttribute('data-created-at');
          return val ? Number(val) : null;
        },
        renderHTML: () => ({}), // Don't render to DOM
      },
      modifiedAt: {
        default: null,
        parseHTML: (element) => {
          const val = element.getAttribute('data-modified-at');
          return val ? Number(val) : null;
        },
        renderHTML: () => ({}),
      },
      tags: {
        default: [],
        parseHTML: (element) => {
          const val = element.getAttribute('data-tags');
          return val ? JSON.parse(val) : [];
        },
        renderHTML: (attributes) => {
          if (!attributes.tags || attributes.tags.length === 0) return {};
          return { 'data-tags': JSON.stringify(attributes.tags) };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'p' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes), 0];
  },
});

export { TimestampedParagraph, generateId };
```

**Step 2: Verify it imports**

```bash
cd /Users/sharon/dev/slips/client && node -e "
import('@tiptap/core').then(() => console.log('OK')).catch(e => console.log('ESM OK - expected in Vite'))
"
```

**Step 3: Commit**

```bash
cd /Users/sharon/dev/slips && git add client/src/editor/TimestampedParagraph.js
git commit -m "feat: create custom Tiptap paragraph node with id, timestamps, and tags"
```

---

### Task 3: Create the timestamp tracking plugin

This plugin hooks into Tiptap's transaction system to auto-stamp paragraphs.

**Files:**
- Create: `client/src/editor/TimestampPlugin.js`

**Step 1: Create the plugin**

Create `client/src/editor/TimestampPlugin.js`:

```js
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';
import { generateId } from './TimestampedParagraph';

const TimestampPlugin = Extension.create({
  name: 'timestampPlugin',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('timestamp'),
        appendTransaction(transactions, oldState, newState) {
          // Only process if document actually changed
          const docChanged = transactions.some((tr) => tr.docChanged);
          if (!docChanged) return null;

          const now = Date.now();
          const tr = newState.tr;
          let modified = false;

          newState.doc.descendants((node, pos) => {
            if (node.type.name !== 'paragraph') return;

            // Assign ID if missing
            if (!node.attrs.id) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                id: generateId(),
                createdAt: node.attrs.createdAt || now,
              });
              modified = true;
              return;
            }

            // Check if this paragraph's content changed
            const oldNode = oldState.doc.nodeAt(pos);
            if (!oldNode || oldNode.type.name !== 'paragraph') {
              // New paragraph or position shifted — check by ID
              let found = false;
              oldState.doc.descendants((oldN) => {
                if (oldN.type.name === 'paragraph' && oldN.attrs.id === node.attrs.id) {
                  found = true;
                  if (!oldN.content.eq(node.content)) {
                    tr.setNodeMarkup(pos, undefined, {
                      ...node.attrs,
                      modifiedAt: now,
                    });
                    modified = true;
                  }
                }
              });
              // If not found in old state, it's new
              if (!found && !node.attrs.createdAt) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  createdAt: now,
                });
                modified = true;
              }
            } else if (!oldNode.content.eq(node.content)) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                modifiedAt: now,
              });
              modified = true;
            }
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});

export default TimestampPlugin;
```

**Step 2: Commit**

```bash
cd /Users/sharon/dev/slips && git add client/src/editor/TimestampPlugin.js
git commit -m "feat: add timestamp tracking plugin for paragraph creation/modification"
```

---

### Task 4: Create content migration utility

Converts plain text string content to Tiptap JSON and vice versa.

**Files:**
- Create: `client/src/editor/contentMigration.js`

**Step 1: Create the migration utility**

Create `client/src/editor/contentMigration.js`:

```js
import { generateId } from './TimestampedParagraph';

/**
 * Detects if content is legacy plain text (string) or Tiptap JSON (object).
 */
export function isLegacyContent(content) {
  return typeof content === 'string';
}

/**
 * Converts a plain text string to Tiptap JSON document.
 * Each line becomes a paragraph node with null timestamps (unknown origin).
 */
export function textToTiptapJson(text) {
  if (!text) {
    return {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: generateId(), createdAt: null, modifiedAt: null, tags: [] },
        },
      ],
    };
  }

  const lines = text.split('\n');
  return {
    type: 'doc',
    content: lines.map((line) => ({
      type: 'paragraph',
      attrs: { id: generateId(), createdAt: null, modifiedAt: null, tags: [] },
      ...(line
        ? { content: [{ type: 'text', text: line }] }
        : {}),
    })),
  };
}

/**
 * Extracts plain text from a Tiptap JSON document.
 * Used by the Gemini agent and for search.
 */
export function tiptapJsonToText(doc) {
  if (!doc || !doc.content) return '';
  return doc.content
    .map((node) => {
      if (!node.content) return '';
      return node.content
        .map((inline) => inline.text || '')
        .join('');
    })
    .join('\n');
}

/**
 * Prepares content for the Tiptap editor.
 * If it's a legacy string, converts it. If it's already JSON, returns as-is.
 */
export function prepareContent(content) {
  if (!content) return textToTiptapJson('');
  if (isLegacyContent(content)) return textToTiptapJson(content);
  return content;
}
```

**Step 2: Commit**

```bash
cd /Users/sharon/dev/slips && git add client/src/editor/contentMigration.js
git commit -m "feat: add content migration utility for plain text to Tiptap JSON conversion"
```

---

### Task 5: Replace textarea with Tiptap editor in DayNote

This is the core migration. Replace the textarea with a Tiptap editor that looks and behaves identically.

**Files:**
- Modify: `client/src/components/DayNote.jsx` (full rewrite of editor section)
- Modify: `client/src/components/DayNote.css` (update styles for Tiptap)

**Step 1: Rewrite DayNote.jsx**

Replace the full content of `client/src/components/DayNote.jsx` with:

```jsx
import { useState, useEffect, useRef, useCallback, forwardRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TimestampedParagraph } from '../editor/TimestampedParagraph';
import TimestampPlugin from '../editor/TimestampPlugin';
import { prepareContent, isLegacyContent } from '../editor/contentMigration';
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
        paragraph: false, // We use our custom paragraph
        // Disable formatting features — keep it plain
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
        // Support Tab key for indentation
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

  // Save note to Firestore
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

  // Subscribe to real-time updates from Firestore
  useEffect(() => {
    if (!spaceId || !editor) return;

    const unsubscribe = subscribeToNote(spaceId, date, (data) => {
      const remoteContent = data.content;
      if (!remoteContent) return;

      // Detect if remote content is different from what we last saved
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

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Combine forwarded ref with local containerRef
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
```

**Step 2: Update DayNote.css**

Replace the full content of `client/src/components/DayNote.css` with:

```css
.day-note {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--border-color);
  box-sizing: border-box;
}

.day-note-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0.5rem 1rem;
  gap: 1rem;
}

.day-note-date {
  font-size: 0.75rem;
  font-weight: normal;
  color: var(--text-secondary);
  margin: 0;
}

.saving-indicator {
  font-size: 0.625rem;
  color: var(--text-secondary);
}

.day-note-paper {
  display: block;
  flex: 1;
}

/* Tiptap editor — styled to look identical to the old textarea */
.day-note-editor {
  width: 100%;
  min-height: calc(100vh - 3rem);
  padding: 0 1rem 1rem;
  font-family: inherit;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--text-primary);
  outline: none;
  box-sizing: border-box;
}

.day-note-editor p {
  margin: 0;
  padding: 0;
}

/* Placeholder styling */
.day-note-editor p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  float: left;
  color: var(--text-secondary);
  pointer-events: none;
  height: 0;
}

/* Remove any ProseMirror default styling */
.ProseMirror {
  outline: none;
}

.ProseMirror:focus {
  outline: none;
}

@media (max-width: 600px) {
  .day-note-editor {
    font-size: 1rem;
    padding: 0 0.75rem 1rem;
  }

  .day-note-header {
    padding: 0.5rem 0.75rem;
  }
}
```

**Step 3: Verify the app builds**

```bash
cd /Users/sharon/dev/slips/client && npm run build
```
Expected: Build succeeds with no errors.

**Step 4: Commit**

```bash
cd /Users/sharon/dev/slips && git add client/src/components/DayNote.jsx client/src/components/DayNote.css
git commit -m "feat: migrate DayNote from textarea to Tiptap editor

Visually identical to the old textarea. Supports auto-save,
real-time sync, tab key, and lazy migration of legacy content."
```

---

### Task 6: Update noteService and useNotes for Tiptap JSON content

The note service and hook need to handle both legacy string content and Tiptap JSON.

**Files:**
- Modify: `client/src/services/noteService.js` (no changes needed — it already passes `content` as-is)
- Modify: `client/src/hooks/useNotes.js:117-121` (updateNoteLocal must handle JSON content)

**Step 1: Verify noteService.js**

Read `client/src/services/noteService.js`. The `updateNote` function uses `setDoc` with `{ merge: true }` and passes `content` directly. Since Firestore natively stores JSON objects, no changes are needed — Tiptap JSON will be stored as a nested object automatically.

**Step 2: Update useNotes.js updateNoteLocal**

The current `updateNoteLocal` sets content as a value. This works for both string and JSON, but verify it handles the new format. No actual code change needed — `setNotes` stores whatever is passed.

**Step 3: Commit (if any changes)**

```bash
cd /Users/sharon/dev/slips && git add client/src/services/noteService.js client/src/hooks/useNotes.js
git commit -m "chore: verify noteService and useNotes handle Tiptap JSON content"
```

---

### Task 7: Create tag service

CRUD operations for tags in Firestore.

**Files:**
- Create: `client/src/services/tagService.js`

**Step 1: Create the tag service**

Create `client/src/services/tagService.js`:

```js
import {
  doc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase';

const TAG_COLORS = [
  '#4285f4', // blue
  '#ea4335', // red
  '#fbbc04', // yellow
  '#34a853', // green
  '#ff6d01', // orange
  '#46bdc6', // teal
  '#7b1fa2', // purple
  '#e91e63', // pink
];

let colorIndex = 0;

function getNextColor() {
  const color = TAG_COLORS[colorIndex % TAG_COLORS.length];
  colorIndex++;
  return color;
}

export async function createTag(spaceId, name) {
  const tagRef = doc(collection(db, 'spaces', spaceId, 'tags'));
  const tag = {
    name,
    color: getNextColor(),
    type: 'manual',
    createdAt: serverTimestamp(),
  };
  await setDoc(tagRef, tag);
  return { id: tagRef.id, ...tag };
}

export async function deleteTag(spaceId, tagId) {
  await deleteDoc(doc(db, 'spaces', spaceId, 'tags', tagId));
}

export async function getTags(spaceId) {
  const tagsRef = collection(db, 'spaces', spaceId, 'tags');
  const snapshot = await getDocs(tagsRef);
  const tags = {};
  snapshot.docs.forEach((d) => {
    tags[d.id] = d.data();
  });
  return tags;
}

export function subscribeToTags(spaceId, onUpdate) {
  const tagsRef = collection(db, 'spaces', spaceId, 'tags');
  return onSnapshot(tagsRef, (snapshot) => {
    const tags = {};
    snapshot.docs.forEach((d) => {
      tags[d.id] = d.data();
    });
    onUpdate(tags);
  });
}
```

**Step 2: Commit**

```bash
cd /Users/sharon/dev/slips && git add client/src/services/tagService.js
git commit -m "feat: add tag service with CRUD operations and Firestore subscriptions"
```

---

### Task 8: Create useTags hook

**Files:**
- Create: `client/src/hooks/useTags.js`

**Step 1: Create the hook**

Create `client/src/hooks/useTags.js`:

```js
import { useState, useEffect } from 'react';
import { subscribeToTags } from '../services/tagService';

export function useTags(spaceId) {
  const [tags, setTags] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!spaceId) return;

    setLoading(true);
    const unsubscribe = subscribeToTags(spaceId, (tagsData) => {
      setTags(tagsData);
      setLoading(false);
    });

    return unsubscribe;
  }, [spaceId]);

  return { tags, loading };
}
```

**Step 2: Commit**

```bash
cd /Users/sharon/dev/slips && git add client/src/hooks/useTags.js
git commit -m "feat: add useTags hook with real-time Firestore subscription"
```

---

### Task 9: Add Firestore rules for tags subcollection

**Files:**
- Modify: `firestore.rules`

**Step 1: Add the rule**

Add inside the `match /spaces/{spaceId}` block, after the notes subcollection rule:

```
      // Tags subcollection - members can read/write tags
      match /tags/{tagId} {
        allow read, write: if request.auth != null && isMember(request.auth.uid, spaceId);
      }
```

**Step 2: Commit**

```bash
cd /Users/sharon/dev/slips && git add firestore.rules
git commit -m "feat: add Firestore rules for tags subcollection"
```

---

### Task 10: Build the tag picker popup component

The floating popup that appears on Cmd+/ to add/remove tags from selected paragraphs.

**Files:**
- Create: `client/src/components/TagPicker.jsx`
- Create: `client/src/components/TagPicker.css`

**Step 1: Create TagPicker.jsx**

Create `client/src/components/TagPicker.jsx`:

```jsx
import { useState, useRef, useEffect } from 'react';
import { createTag } from '../services/tagService';
import './TagPicker.css';

export function TagPicker({ tags, activeTags, position, spaceId, onToggleTag, onClose }) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const filteredTags = Object.entries(tags).filter(([, tag]) =>
    tag.name.toLowerCase().includes(search.toLowerCase())
  );

  const showCreateOption = search.trim() &&
    !Object.values(tags).some(t => t.name.toLowerCase() === search.trim().toLowerCase());

  async function handleCreateTag() {
    if (!search.trim() || creating) return;
    setCreating(true);
    try {
      const newTag = await createTag(spaceId, search.trim());
      onToggleTag(newTag.id);
      setSearch('');
    } catch (err) {
      console.error('Error creating tag:', err);
    }
    setCreating(false);
  }

  return (
    <div
      className="tag-picker"
      ref={containerRef}
      style={{ top: position.top, left: position.left }}
    >
      <input
        ref={inputRef}
        className="tag-picker-search"
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && showCreateOption) {
            handleCreateTag();
          }
        }}
        placeholder="Search or create tag..."
      />
      <div className="tag-picker-list">
        {filteredTags.map(([tagId, tag]) => {
          const isActive = activeTags.includes(tagId);
          return (
            <button
              key={tagId}
              className={`tag-picker-item ${isActive ? 'active' : ''}`}
              onClick={() => onToggleTag(tagId)}
            >
              <span className="tag-dot" style={{ backgroundColor: tag.color }} />
              <span className="tag-name">{tag.name}</span>
              {isActive && <span className="tag-check">✓</span>}
            </button>
          );
        })}
        {showCreateOption && (
          <button
            className="tag-picker-item tag-picker-create"
            onClick={handleCreateTag}
            disabled={creating}
          >
            <span className="tag-dot tag-dot-new">+</span>
            <span className="tag-name">Create "{search.trim()}"</span>
          </button>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Create TagPicker.css**

Create `client/src/components/TagPicker.css`:

```css
.tag-picker {
  position: fixed;
  z-index: 100;
  width: 220px;
  max-height: 280px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tag-picker-search {
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: transparent;
  font-family: inherit;
  font-size: 0.8125rem;
  color: var(--text-primary);
  outline: none;
  box-sizing: border-box;
}

.tag-picker-list {
  overflow-y: auto;
  flex: 1;
}

.tag-picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 0.8125rem;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.tag-picker-item:hover {
  background: var(--bg-hover, #f5f5f5);
}

.tag-picker-item.active {
  background: var(--bg-hover, #f5f5f5);
}

.tag-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.tag-dot-new {
  background: var(--text-secondary);
  color: var(--bg-primary, #fff);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.625rem;
  font-weight: bold;
}

.tag-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-check {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.tag-picker-create {
  border-top: 1px solid var(--border-color, #e0e0e0);
}

@media (prefers-color-scheme: dark) {
  .tag-picker {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }
}
```

**Step 3: Verify build**

```bash
cd /Users/sharon/dev/slips/client && npm run build
```

**Step 4: Commit**

```bash
cd /Users/sharon/dev/slips && git add client/src/components/TagPicker.jsx client/src/components/TagPicker.css
git commit -m "feat: add tag picker popup component with search, create, and toggle"
```

---

### Task 11: Integrate tag picker and Cmd+/ shortcut into DayNote

Wire up the tag picker popup to the Tiptap editor via Cmd+/ keyboard shortcut.

**Files:**
- Modify: `client/src/components/DayNote.jsx` (add tag picker integration)

**Step 1: Update DayNote to accept tags and show tag picker**

Add to the DayNote component:
1. Accept `tags` and `spaceId` props (already has spaceId)
2. State for `showTagPicker` and `tagPickerPosition`
3. Cmd+/ keybinding in the editor that:
   - Gets the current selection's paragraph node(s)
   - Calculates popup position from cursor coordinates
   - Shows the tag picker
4. `onToggleTag` handler that adds/removes tag IDs from selected paragraph attrs
5. Render `<TagPicker>` when open

The specific code changes depend on the current state of DayNote.jsx after Task 5. The key additions:

```jsx
// Add to imports
import { TagPicker } from './TagPicker';

// Add to component state
const [showTagPicker, setShowTagPicker] = useState(false);
const [tagPickerPosition, setTagPickerPosition] = useState({ top: 0, left: 0 });

// Add Cmd+/ handler to editor extensions or editorProps.handleKeyDown
if ((event.metaKey || event.ctrlKey) && event.key === '/') {
  event.preventDefault();
  const { from, to } = editor.state.selection;
  const coords = editor.view.coordsAtPos(from);
  setTagPickerPosition({ top: coords.bottom + 4, left: coords.left });
  setShowTagPicker(true);
  return true;
}

// Add toggle handler
function handleToggleTag(tagId) {
  const { from, to } = editor.state.selection;
  const { tr } = editor.state;
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'paragraph') {
      const tags = [...(node.attrs.tags || [])];
      const idx = tags.indexOf(tagId);
      if (idx >= 0) {
        tags.splice(idx, 1);
      } else {
        tags.push(tagId);
      }
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, tags });
    }
  });
  editor.view.dispatch(tr);
}

// Render in JSX after EditorContent
{showTagPicker && (
  <TagPicker
    tags={tags}
    activeTags={getActiveTagsForSelection()}
    position={tagPickerPosition}
    spaceId={spaceId}
    onToggleTag={handleToggleTag}
    onClose={() => setShowTagPicker(false)}
  />
)}
```

**Step 2: Update Notes.jsx to pass tags to DayNote**

In `Notes.jsx`, use the `useTags` hook and pass `tags` to each `<DayNote>`:

```jsx
import { useTags } from '../hooks/useTags';

// Inside Notes component
const { tags } = useTags(space?.id);

// In the DayNote render
<DayNote
  key={date}
  ref={date === todayDate ? setTodayRef : null}
  date={date}
  content={notes[date]?.content || ''}
  spaceId={space?.id}
  tags={tags}
  onContentChange={(content) => updateNoteLocal(date, content)}
/>
```

**Step 3: Verify build and test Cmd+/ shortcut**

```bash
cd /Users/sharon/dev/slips/client && npm run build
```

**Step 4: Commit**

```bash
cd /Users/sharon/dev/slips && git add client/src/components/DayNote.jsx client/src/components/Notes.jsx
git commit -m "feat: integrate tag picker with Cmd+/ shortcut in editor"
```

---

### Task 12: Add tag gutter to DayNote

Display colored tag indicators on the left side of each paragraph.

**Files:**
- Modify: `client/src/components/DayNote.jsx` (add gutter rendering)
- Modify: `client/src/components/DayNote.css` (add gutter styles)

**Step 1: Add gutter component**

The gutter reads paragraph positions from the Tiptap editor and renders colored dots aligned to each paragraph that has tags. It's a separate div positioned to the left of the editor.

```jsx
function TagGutter({ editor, tags, onTagClick }) {
  const [gutterItems, setGutterItems] = useState([]);

  useEffect(() => {
    if (!editor) return;

    function updateGutter() {
      const items = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && node.attrs.tags?.length > 0) {
          const dom = editor.view.nodeDOM(pos);
          if (dom) {
            const rect = dom.getBoundingClientRect();
            const editorRect = editor.view.dom.getBoundingClientRect();
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
              onClick={() => onTagClick(tagId)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
```

**Step 2: Add gutter CSS**

```css
.day-note-paper {
  display: flex;
  position: relative;
}

.tag-gutter {
  width: 24px;
  flex-shrink: 0;
  position: relative;
}

.tag-gutter-item {
  position: absolute;
  left: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 4px;
}

.tag-gutter-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s;
}

.tag-gutter-dot:hover {
  opacity: 1;
  transform: scale(1.3);
}
```

**Step 3: Render gutter in DayNote.jsx**

Update the JSX in DayNote to include the gutter:

```jsx
<div className="day-note-paper">
  <TagGutter editor={editor} tags={tags} onTagClick={handleTagFilter} />
  <EditorContent editor={editor} />
</div>
```

**Step 4: Verify build**

```bash
cd /Users/sharon/dev/slips/client && npm run build
```

**Step 5: Commit**

```bash
cd /Users/sharon/dev/slips && git add client/src/components/DayNote.jsx client/src/components/DayNote.css
git commit -m "feat: add tag gutter with colored indicators on left side of editor"
```

---

### Task 13: Add tag filter state and in-place highlight mode

**Files:**
- Modify: `client/src/components/Notes.jsx` (add filter state and filter bar)
- Modify: `client/src/components/Notes.css` (add filter bar styles)
- Modify: `client/src/components/DayNote.jsx` (accept activeFilter prop, dim untagged paragraphs)
- Modify: `client/src/components/DayNote.css` (dimming styles)

**Step 1: Add filter state to Notes.jsx**

```jsx
const [activeFilter, setActiveFilter] = useState(null); // { tagId, mode: 'highlight' | 'consolidated' }

function handleTagFilter(tagId) {
  setActiveFilter({ tagId, mode: 'highlight' });
}

function clearFilter() {
  setActiveFilter(null);
}

function toggleFilterMode() {
  setActiveFilter(prev => prev ? { ...prev, mode: prev.mode === 'highlight' ? 'consolidated' : 'highlight' } : null);
}
```

Pass `activeFilter` and `onTagFilter` to each DayNote.

**Step 2: Add filter bar JSX to Notes.jsx**

```jsx
{activeFilter && (
  <div className="filter-bar">
    <span className="filter-tag-dot" style={{ backgroundColor: tags[activeFilter.tagId]?.color }} />
    <span className="filter-tag-name">{tags[activeFilter.tagId]?.name}</span>
    <button className="filter-mode-toggle" onClick={toggleFilterMode}>
      {activeFilter.mode === 'highlight' ? 'All notes' : 'In-place'}
    </button>
    <button className="filter-clear" onClick={clearFilter}>×</button>
  </div>
)}
```

**Step 3: Add dimming CSS to DayNote.css**

```css
.day-note-editor p.dimmed {
  opacity: 0.25;
  transition: opacity 0.15s;
}

.day-note-editor p.dimmed:hover {
  opacity: 0.5;
}

.day-note-editor p.tag-highlighted {
  border-left: 2px solid var(--tag-highlight-color, #4285f4);
  padding-left: calc(1rem - 2px);
}
```

**Step 4: Add filter bar CSS to Notes.css**

```css
.filter-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  background: var(--bg-primary, #fff);
  border-bottom: 1px solid var(--border-color);
  font-size: 0.8125rem;
}

.filter-tag-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.filter-tag-name {
  color: var(--text-primary);
}

.filter-mode-toggle,
.filter-clear {
  background: none;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 0.75rem;
  cursor: pointer;
  color: var(--text-secondary);
}

.filter-clear {
  border: none;
  font-size: 1rem;
  padding: 0 4px;
}
```

**Step 5: Apply dimming in DayNote via Tiptap decorations or CSS classes**

In DayNote, when `activeFilter` is set, add a CSS class to paragraphs based on whether they contain the filtered tag. This can be done via Tiptap's `NodeView` or by adding a decoration plugin.

**Step 6: Verify build**

```bash
cd /Users/sharon/dev/slips/client && npm run build
```

**Step 7: Commit**

```bash
cd /Users/sharon/dev/slips && git add client/src/components/Notes.jsx client/src/components/Notes.css client/src/components/DayNote.jsx client/src/components/DayNote.css
git commit -m "feat: add tag filtering with in-place highlight mode and filter bar"
```

---

### Task 14: Add consolidated cross-day tag view

**Files:**
- Create: `client/src/components/TagView.jsx`
- Create: `client/src/components/TagView.css`
- Modify: `client/src/components/Notes.jsx` (render TagView when mode is 'consolidated')

**Step 1: Create TagView.jsx**

A component that queries all notes for the space, extracts paragraphs matching the active tag, and displays them grouped by date.

```jsx
import { useState, useEffect } from 'react';
import { getNotesInRange } from '../services/noteService';
import { prepareContent, isLegacyContent } from '../editor/contentMigration';
import './TagView.css';

export function TagView({ spaceId, tagId, tagName, tagColor }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!spaceId || !tagId) return;

    async function loadTaggedNotes() {
      setLoading(true);

      // Load last 90 days of notes
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 90);

      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      const notes = await getNotesInRange(spaceId, startStr, endStr);

      const taggedEntries = [];
      for (const [date, noteData] of Object.entries(notes)) {
        const content = prepareContent(noteData.content);
        if (!content.content) continue;

        const matchingParagraphs = content.content.filter(
          (node) => node.attrs?.tags?.includes(tagId)
        );

        if (matchingParagraphs.length > 0) {
          taggedEntries.push({
            date,
            paragraphs: matchingParagraphs,
          });
        }
      }

      // Sort by date descending (newest first)
      taggedEntries.sort((a, b) => b.date.localeCompare(a.date));
      setEntries(taggedEntries);
      setLoading(false);
    }

    loadTaggedNotes();
  }, [spaceId, tagId]);

  if (loading) {
    return <div className="tag-view-loading">Loading...</div>;
  }

  if (entries.length === 0) {
    return <div className="tag-view-empty">No notes tagged with this tag yet.</div>;
  }

  return (
    <div className="tag-view">
      {entries.map(({ date, paragraphs }) => (
        <div key={date} className="tag-view-day">
          <h3 className="tag-view-date">{date}</h3>
          {paragraphs.map((para) => (
            <p key={para.attrs.id} className="tag-view-paragraph" style={{ borderLeftColor: tagColor }}>
              {para.content?.map((c) => c.text).join('') || ''}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
```

**Step 2: Create TagView.css**

```css
.tag-view {
  max-width: 800px;
  margin: 0 auto;
  padding: 1rem;
}

.tag-view-loading,
.tag-view-empty {
  text-align: center;
  color: var(--text-secondary);
  padding: 2rem;
  font-size: 0.875rem;
}

.tag-view-day {
  margin-bottom: 1.5rem;
}

.tag-view-date {
  font-size: 0.75rem;
  font-weight: normal;
  color: var(--text-secondary);
  margin: 0 0 0.5rem;
}

.tag-view-paragraph {
  margin: 0;
  padding: 0.25rem 0 0.25rem 0.75rem;
  border-left: 2px solid;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--text-primary);
}
```

**Step 3: Wire into Notes.jsx**

When `activeFilter.mode === 'consolidated'`, render `<TagView>` instead of the notes list:

```jsx
{activeFilter?.mode === 'consolidated' ? (
  <TagView
    spaceId={space?.id}
    tagId={activeFilter.tagId}
    tagName={tags[activeFilter.tagId]?.name}
    tagColor={tags[activeFilter.tagId]?.color}
  />
) : (
  <main className="notes-list">
    {/* existing notes rendering */}
  </main>
)}
```

**Step 4: Verify build**

```bash
cd /Users/sharon/dev/slips/client && npm run build
```

**Step 5: Commit**

```bash
cd /Users/sharon/dev/slips && git add client/src/components/TagView.jsx client/src/components/TagView.css client/src/components/Notes.jsx
git commit -m "feat: add consolidated cross-day tag view with date grouping"
```

---

### Task 15: Update Gemini agent for Tiptap JSON content

**Files:**
- Modify: `functions/src/dailyAgent.js` (update content reading/writing for Tiptap JSON)

**Step 1: Add utility functions for Tiptap JSON**

Add to `dailyAgent.js`:

```js
function tiptapJsonToText(doc) {
  if (!doc || !doc.content) return '';
  return doc.content
    .map((node) => {
      if (!node.content) return '';
      return node.content.map((inline) => inline.text || '').join('');
    })
    .join('\n');
}

function textToTiptapJson(text) {
  if (!text) return { type: 'doc', content: [{ type: 'paragraph', attrs: { id: generateId(), createdAt: Date.now(), modifiedAt: null, tags: [] } }] };
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      attrs: { id: generateId(), createdAt: Date.now(), modifiedAt: null, tags: [] },
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    })),
  };
}

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}
```

**Step 2: Update `runAgentForUser` to handle both content formats**

In the note reading step, detect format and extract text:

```js
const rawContent = noteSnap.exists ? noteSnap.data().content : '';
const noteContent = typeof rawContent === 'string' ? rawContent : tiptapJsonToText(rawContent);
```

In the tomorrow's note writing step, produce Tiptap JSON:

```js
const taskListJson = textToTiptapJson(parsed.tomorrowNote || formatTaskList(updatedOpenTasks));

// Prepend: merge paragraph arrays
let newContent;
if (tomorrowSnap.exists && typeof existingRaw === 'object' && existingRaw.content) {
  // Existing Tiptap JSON — prepend paragraphs
  const separator = { type: 'paragraph', attrs: { id: generateId(), createdAt: Date.now(), modifiedAt: null, tags: [] }, content: [{ type: 'text', text: '---' }] };
  newContent = {
    type: 'doc',
    content: [...taskListJson.content, separator, ...existingRaw.content],
  };
} else {
  newContent = taskListJson;
}
```

**Step 3: Verify functions load**

```bash
cd /Users/sharon/dev/slips/functions && node -e "require('./index.js'); console.log('OK')"
```

**Step 4: Commit**

```bash
cd /Users/sharon/dev/slips && git add functions/src/dailyAgent.js
git commit -m "feat: update Gemini agent to read/write Tiptap JSON note content"
```

---

### Task 16: Deploy everything

**Step 1: Build client**

```bash
cd /Users/sharon/dev/slips/client && npm run build
```

**Step 2: Deploy all**

```bash
firebase deploy --only functions,firestore:rules,hosting --project=slips-prod
```

**Step 3: Commit any remaining changes**

```bash
cd /Users/sharon/dev/slips && git add -A && git status
```

Only commit if there are meaningful changes.

**Step 4: Test manually**

1. Open the app — existing notes should load in the Tiptap editor (auto-migrated from plain text)
2. Type in a note — auto-save should work
3. Press Cmd+/ — tag picker should appear
4. Create a tag and apply it — gutter dot should appear
5. Click a gutter dot — filter bar should appear, untagged paragraphs dim
6. Toggle to "All notes" — consolidated view shows tagged paragraphs across days
