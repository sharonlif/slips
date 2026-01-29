import {
  doc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit as firestoreLimit,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase';

export async function updateNote(spaceId, date, content) {
  const noteRef = doc(db, 'spaces', spaceId, 'notes', date);

  await setDoc(noteRef, {
    content: content,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export async function getNotes(spaceId, dates) {
  // Fetch notes for specific dates
  const notesRef = collection(db, 'spaces', spaceId, 'notes');

  // Firestore doesn't support 'in' queries with more than 30 items
  // So we batch if needed, but typically we'll fetch 30 days at a time
  const batchSize = 30;
  const results = {};

  for (let i = 0; i < dates.length; i += batchSize) {
    const batch = dates.slice(i, i + batchSize);

    if (batch.length === 0) continue;

    const q = query(
      notesRef,
      where('__name__', 'in', batch)
    );

    const snapshot = await getDocs(q);

    snapshot.docs.forEach(doc => {
      results[doc.id] = doc.data();
    });
  }

  return results;
}

export async function getNotesInRange(spaceId, startDate, endDate) {
  const notesRef = collection(db, 'spaces', spaceId, 'notes');

  const q = query(
    notesRef,
    where('__name__', '>=', startDate),
    where('__name__', '<=', endDate),
    orderBy('__name__', 'desc')
  );

  const snapshot = await getDocs(q);
  const results = {};

  snapshot.docs.forEach(doc => {
    results[doc.id] = doc.data();
  });

  return results;
}
