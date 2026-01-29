import {
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase';

export async function createPersonalSpace(userId) {
  // Create the space document
  const spaceRef = doc(collection(db, 'spaces'));
  const spaceId = spaceRef.id;

  await setDoc(spaceRef, {
    name: 'Personal',
    type: 'personal',
    createdAt: serverTimestamp(),
    ownerId: userId
  });

  // Create membership document with composite ID
  const membershipId = `${userId}_${spaceId}`;
  const membershipRef = doc(db, 'memberships', membershipId);

  await setDoc(membershipRef, {
    userId: userId,
    spaceId: spaceId,
    role: 'owner',
    joinedAt: serverTimestamp()
  });

  return spaceId;
}

export async function getUserPersonalSpace(userId) {
  // Query memberships for this user
  const membershipsRef = collection(db, 'memberships');
  const q = query(membershipsRef, where('userId', '==', userId));
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    return null;
  }

  // Get the first membership (personal space)
  const membership = snapshot.docs[0].data();
  const spaceId = membership.spaceId;

  // Fetch the space document
  const spaceRef = doc(db, 'spaces', spaceId);
  const spaceSnap = await getDoc(spaceRef);

  if (!spaceSnap.exists()) {
    return null;
  }

  return {
    id: spaceId,
    ...spaceSnap.data()
  };
}
