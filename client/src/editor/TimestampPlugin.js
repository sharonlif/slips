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
            if (oldNode && oldNode.type.name === 'paragraph' && oldNode.attrs.id === node.attrs.id) {
              if (!oldNode.content.eq(node.content)) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  modifiedAt: now,
                });
                modified = true;
              }
            }
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});

export default TimestampPlugin;
