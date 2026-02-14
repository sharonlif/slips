import { useState, useRef, useEffect } from 'react';
import { createTag } from '../services/tagService';
import './TagPicker.css';

export function TagPicker({ tags, activeTags, position, spaceId, onToggleTag, onClose }) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

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

  // Build flat list of selectable items for keyboard nav
  const items = [
    ...filteredTags.map(([tagId]) => ({ type: 'tag', tagId })),
    ...(showCreateOption ? [{ type: 'create' }] : []),
  ];

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

  function selectHighlighted() {
    const item = items[highlightedIndex];
    if (!item) return;
    if (item.type === 'tag') onToggleTag(item.tagId);
    else if (item.type === 'create') handleCreateTag();
  }

  function handleInputKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(i => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectHighlighted();
    }
  }

  // Scroll highlighted item into view
  useEffect(() => {
    const el = listRef.current?.children[highlightedIndex];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

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
        onChange={(e) => { setSearch(e.target.value); setHighlightedIndex(0); }}
        onKeyDown={handleInputKeyDown}
        placeholder="Search or create tag..."
      />
      <div className="tag-picker-list" ref={listRef}>
        {filteredTags.map(([tagId, tag], i) => {
          const isActive = activeTags.includes(tagId);
          return (
            <button
              key={tagId}
              className={`tag-picker-item ${isActive ? 'active' : ''} ${highlightedIndex === i ? 'highlighted' : ''}`}
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
            className={`tag-picker-item tag-picker-create ${highlightedIndex === filteredTags.length ? 'highlighted' : ''}`}
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
