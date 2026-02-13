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
