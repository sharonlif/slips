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
