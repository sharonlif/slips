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
