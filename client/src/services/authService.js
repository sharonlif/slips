import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut as firebaseSignOut
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { createPersonalSpace } from './spaceService';

const googleProvider = new GoogleAuthProvider();

async function handleUserFirstSignIn(user) {
  const userRef = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (!userSnap.exists()) {
    await setDoc(userRef, {
      email: user.email,
      timezone,
      createdAt: serverTimestamp()
    });
    await createPersonalSpace(user.uid);
  } else {
    // Update timezone on every login (handles travel)
    await setDoc(userRef, { timezone }, { merge: true });
  }
}

// Check for redirect result on page load
export async function checkRedirectResult() {
  try {
    const result = await getRedirectResult(auth);
    if (result?.user) {
      await handleUserFirstSignIn(result.user);
      return result.user;
    }
  } catch (err) {
    console.error('Redirect result error:', err);
  }
  return null;
}

export async function signInWithGoogle() {
  // Try popup first, fall back to redirect on mobile/Safari
  try {
    const result = await signInWithPopup(auth, googleProvider);
    await handleUserFirstSignIn(result.user);
    return result.user;
  } catch (err) {
    // If popup blocked or fails, use redirect
    if (
      err.code === 'auth/popup-blocked' ||
      err.code === 'auth/popup-closed-by-user' ||
      err.code === 'auth/cancelled-popup-request'
    ) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw err;
  }
}

export async function signOut() {
  await firebaseSignOut(auth);
}
