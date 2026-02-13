# Tags, Change Tracking & Context System — Design Document

## Overview

A system that adds tagging, per-paragraph change tracking, and contextual filtering to the Slips note-taking app. The notepad stays visually simple but gains invisible metadata that connects notes to tags, meetings, and projects.

**Core capabilities:**
1. Track when each paragraph was written/modified (timestamps on nodes)
2. Tag paragraphs with user-created tags (multiple tags per paragraph)
3. View notes filtered by tag (in-place highlight or cross-day consolidated view)
4. Future: auto-tag paragraphs based on calendar meeting times

## Decision Log

### Decision 1: Migrate from textarea to Tiptap/ProseMirror

**Chosen:** Tiptap (ProseMirror wrapper)

**Why:** A plain `<textarea>` stores content as a single string. Tags on "line 5" break when the user inserts a line above. Tiptap gives each paragraph a stable node with a unique ID that survives insertions, deletions, and reordering. Tags become node attributes, not fragile line-number references.

**Alternatives considered:**
- **Keep textarea + track by line number** — Fragile. Line numbers shift on every edit. Would require diffing and remapping on every save. Rejected.
- **Keep textarea + track by content hash** — Slightly better, but fails on duplicate lines, partial edits, and doesn't support timestamps. Rejected.
- **Tiptap** — Structured document with stable node IDs, inline attributes, transaction hooks, and extensibility. Selected.

**Trade-offs accepted:**
- One-time migration effort to replace the editor component
- Note content changes from plain string to JSON (larger storage, but negligible at this scale)
- Tiptap adds ~150KB to the client bundle (tree-shakeable)

**What stays the same:**
- Visual appearance identical to current textarea (no toolbar, no formatting)
- Auto-save with 500ms debounce
- Real-time Firestore sync
- Tab key support
- Auto-resize behavior

### Decision 2: Tags stored on paragraph nodes (not in separate collection)

**Chosen:** Approach 1 — Tags as paragraph node attributes

**Why:** Everything lives in the document structure. Tags move with paragraphs naturally. No sync issues between document and external annotation store. Simplest model.

**Alternatives considered:**

- **Approach 2: Separate annotations collection** — `annotations/{id}` documents with `{ paragraphId, tagId, createdAt }`. Cleaner separation but requires client-side joins, more Firestore reads, and annotations can get out of sync if paragraphs are deleted. Rejected for now.

- **Approach 3: Hybrid — tags in document + index collection** — Tags on nodes (source of truth) plus a `tagIndex` collection for fast cross-day queries. Best of both worlds but adds sync complexity. **Documented as future upgrade path** if cross-day tag queries become slow.

**When to revisit:** If a user has hundreds of notes and filtering by tag across all days becomes noticeably slow (currently queries all notes client-side). At that point, add the tag index collection from Approach 3.

### Decision 3: Whole-paragraph tagging (not partial text ranges)

**Chosen:** Tags apply to entire paragraphs/lines.

**Why:** Simpler model, cleaner gutter display, easier to reason about. A paragraph is the natural unit for "a thought" or "an action item."

**Alternative:** Partial text range tagging — tag just a few words within a line. More granular but significantly more complex (range tracking, overlapping ranges, split/merge on editing). Rejected — YAGNI.

**When to revisit:** If users consistently want to tag individual words or phrases within a paragraph.

### Decision 4: Tag creation via keyboard shortcut (Cmd+/)

**Chosen:** Select paragraphs → Cmd+/ → floating tag picker popup.

**Alternatives considered:**
- **Inline hashtag syntax** (`#project-x` typed in text) — Pollutes the note content with metadata. The whole point is keeping the notepad simple. Rejected.
- **Sidebar tag panel** — Always visible, takes horizontal space. Rejected for default, but may be added later.
- **Right-click context menu** — Less discoverable. Rejected as primary method.

### Decision 5: Multiple tags per paragraph

**Chosen:** A paragraph can have any number of tags.

**Why:** A line about a project discussed in a meeting naturally belongs to both `#project-x` and `#meeting-with-dave`. Limiting to one tag forces artificial choices.

### Decision 6: Tag filter has two modes (toggle)

**Chosen:** In-place highlight (default) + consolidated cross-day view (toggle).

**Alternatives considered:**
- **In-place only** — Doesn't let you see all notes for a tag across days. Rejected.
- **Separate view only** — Loses the date context of where things were written. Rejected.
- **Both as toggle** — Best of both. Selected.

### Decision 7: Lazy migration (no batch migration)

**Chosen:** Notes convert from plain text to Tiptap JSON on first load.

**Why:** No downtime, no migration script, no batch job. Each note converts transparently when a user opens it. Old notes with string `content` are detected and converted to Tiptap JSON, then saved back.

**Trade-off:** First open of each old note has a tiny conversion overhead (negligible — it's just splitting a string by newlines and wrapping in paragraph nodes).

## Data Model

### Tiptap Document Schema (stored in `spaces/{spaceId}/notes/{date}.content`)

```json
{
  "type": "doc",
  "content": [
    {
      "type": "paragraph",
      "attrs": {
        "id": "a1b2c3d4",
        "createdAt": 1739395200000,
        "modifiedAt": 1739398800000,
        "tags": ["tag-id-1", "tag-id-2"]
      },
      "content": [
        { "type": "text", "text": "Follow up with Dave on the API spec" }
      ]
    },
    {
      "type": "paragraph",
      "attrs": {
        "id": "e5f6g7h8",
        "createdAt": 1739395260000,
        "modifiedAt": null,
        "tags": []
      },
      "content": [
        { "type": "text", "text": "Another line of notes" }
      ]
    }
  ]
}
```

**Field details:**
- `id` — Short UUID, generated on paragraph creation. Stable across edits. Never changes.
- `createdAt` — Unix timestamp (ms). Set once on creation. `null` for migrated legacy content.
- `modifiedAt` — Unix timestamp (ms). Updated on text edits. Not updated on tag changes.
- `tags` — Array of tag ID strings. Empty array by default.

### Tags Collection: `spaces/{spaceId}/tags/{tagId}`

```json
{
  "name": "Project X",
  "color": "#4285f4",
  "type": "manual",
  "createdAt": 1739395200000
}
```

- `type`: `"manual"` (user-created) or `"meeting"` (auto-created from calendar, future feature)
- `color`: Assigned from a predefined palette on creation
- Tags are per-space, shared across all notes in that space

### Firestore Rules Addition

```
match /spaces/{spaceId}/tags/{tagId} {
  allow read, write: if request.auth != null && isMember(request.auth.uid, spaceId);
}
```

## Architecture

### Editor Component

```
DayNote.jsx
├── Tiptap Editor (EditorContent)
│   ├── Custom Paragraph node (with id, createdAt, modifiedAt, tags attrs)
│   ├── onTransaction hook (timestamps new/modified paragraphs)
│   └── Cmd+/ keybinding (opens tag picker)
├── Tag Gutter (left column)
│   ├── Colored dots per paragraph, aligned vertically
│   ├── Hover → tag name tooltip
│   └── Click → activate tag filter
└── Tag Picker Popup (floating, on Cmd+/)
    ├── Search/filter field
    ├── Existing tags list (colored dot + name)
    ├── "Create new tag" option
    └── Toggle to remove tags from selected paragraphs
```

### Tag Filtering

```
Notes.jsx
├── Active filter state: { tagId, mode: 'highlight' | 'consolidated' }
├── Filter bar (shown when filter active)
│   ├── "Filtering: Project X [x]"
│   └── Toggle: "In-place" / "All notes"
├── In-place mode:
│   └── Passes activeTagId to DayNote → paragraphs without tag get dimmed
└── Consolidated mode:
    └── Queries all notes, extracts paragraphs with matching tag, groups by date
```

### Timestamp Tracking Flow

```
User types in paragraph
        │
        ▼
Tiptap onTransaction fires
        │
        ├── New paragraph detected? → Set id + createdAt
        └── Existing paragraph modified? → Update modifiedAt
        │
        ▼
Auto-save (500ms debounce) → Firestore
```

### Future: Calendar Meeting Auto-Tagging

```
Calendar sync provides meetings:
  { title: "Standup", start: 14:00, end: 14:30, participants: [...] }
        │
        ▼
Auto-create tag: { name: "Standup - Feb 12", type: "meeting", ... }
        │
        ▼
Paragraphs written during 14:00-14:30 (via createdAt) →
  Suggest auto-tag or auto-apply meeting tag
        │
        ▼
Same filter/view system — click meeting tag to see all meeting notes
```

## Gemini Agent Compatibility

The daily agent needs minor updates:

1. **Reading notes:** Extract plain text from Tiptap JSON by iterating paragraph nodes and joining text content with newlines. Simple utility function.

2. **Writing tomorrow's note:** Generate Tiptap JSON instead of plain text. Each task line becomes a paragraph node with a new `id`, `createdAt` set to generation time, and empty `tags`.

3. **Prepending to existing notes:** Merge paragraph arrays (concat new paragraphs before existing ones) instead of string concatenation.

4. **No changes to:** Gemini prompt, response format, context tracking, or task management logic. Gemini works with plain text — the Tiptap structure is transparent to it.

## UI Specifications

### Editor Appearance
- Identical to current textarea — no toolbar, no formatting UI
- Same font family, size, line height, padding
- Same full-viewport-height behavior
- Cursor and selection feel native

### Tag Gutter (left column)
- Width: ~24px
- Background: transparent (or very subtle)
- Per paragraph: small colored dot (8px circle) if tagged
- Multiple tags on one paragraph: stacked dots or multi-colored indicator
- Hover: tooltip with tag name(s)
- Click: activate filter for that tag

### Tag Picker (Cmd+/ popup)
- Floating popup, positioned near cursor/selection
- Search field at top (auto-focused)
- Scrollable list of existing tags (colored dot + name)
- Checkmarks next to tags already applied to selection
- "Create new tag" at bottom (with color picker)
- Escape or click-outside to dismiss

### Filter Bar (top of notes view)
- Appears when a tag filter is active
- Shows: colored dot + tag name + clear button (x)
- Toggle button: "In-place" / "All notes"
- Compact, doesn't take much vertical space

## Future Expansion Paths

### Tag Index Collection (Approach 3 upgrade)
If cross-day tag queries become slow, add a `tagIndex` collection:
```json
// tagIndex/{autoId}
{
  "tagId": "tag-id-1",
  "spaceId": "space-id",
  "date": "2026-02-12",
  "paragraphId": "a1b2c3d4"
}
```
Updated on save via Firestore trigger or client-side write. Enables fast queries like "all paragraphs tagged project-x" without scanning every note.

### Meeting Auto-Tagging
When calendar sync is fully implemented:
1. Fetch day's meetings from Google Calendar
2. Create `type: "meeting"` tags with participant metadata
3. On note save, check paragraph `createdAt` against meeting time ranges
4. Auto-suggest or auto-apply meeting tags
5. Meeting tags appear in gutter with a calendar icon instead of a dot

### Partial Text Range Tagging
If needed, extend from paragraph-level to range-level:
- Use Tiptap marks (inline) instead of node attributes
- Marks can span partial text within a paragraph
- Requires range tracking and handling of split/merge on editing
- Significantly more complex — only add if user demand is clear

### Tag Hierarchies / Nesting
- Tags could support parent-child relationships (e.g., `Projects > Project X`)
- Add `parentTagId` field to tag documents
- Filter by parent shows all children's content
- Not needed now — flat tags are sufficient

### Collaborative Tagging
- When spaces support multiple members, tags become shared
- Tag creation/deletion may need permissions
- Paragraph `modifiedBy` field could track who wrote what

### Search
- Full-text search across notes filtered by tag
- Could use Firestore full-text search or Algolia
- Tag filtering narrows the search scope

## Dependencies

### New Client Dependencies
- `@tiptap/react` — React integration
- `@tiptap/starter-kit` — Base extensions (document, paragraph, text, history)
- `@tiptap/extension-placeholder` — Placeholder text

### No New Backend Dependencies
- Tag CRUD is standard Firestore operations
- No new Cloud Functions needed for tags (client reads/writes directly)
