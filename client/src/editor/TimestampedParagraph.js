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
        renderHTML: () => ({}),
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
        keepOnSplit: true,
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
