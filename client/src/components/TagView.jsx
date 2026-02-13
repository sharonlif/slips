import { useState, useEffect } from 'react';
import { getNotesInRange } from '../services/noteService';
import { prepareContent } from '../editor/contentMigration';
import './TagView.css';

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
        if (!content || !content.content) continue;

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
          <h3 className="tag-view-date">{formatDisplayDate(date)}</h3>
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
