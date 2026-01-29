import {
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { createPersonalSpace } from './spaceService';

const googleProvider = new GoogleAuthProvider();

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;

  // Check if user doc exists
  const userRef = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    // First time sign-in: create user doc and personal space
    await setDoc(userRef, {
      email: user.email,
      createdAt: serverTimestamp()
    });

    await createPersonalSpace(user.uid);
  }

  return user;
}

export async function signOut() {
  await firebaseSignOut(auth);
}
