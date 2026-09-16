// Firebase setup for Cinema Classics.
//
// The apiKey below is NOT a secret — Firebase web config is meant to be
// public (it just identifies the project). Actual access control lives in
// Firestore Security Rules (see /firestore.rules in this repo), which only
// allow reading/writing the single "state/watched" document used by this
// app. If you ever want stronger protection, add Firebase Authentication
// and rules keyed to a signed-in user instead.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBaL-q4p3Xna-wUldz7uGWCLdjNuzPBeX0",
  authDomain: "movies-1674c.firebaseapp.com",
  projectId: "movies-1674c",
  storageBucket: "movies-1674c.firebasestorage.app",
  messagingSenderId: "890557180977",
  appId: "1:890557180977:web:e06f57a0b05390095ff910",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

const WATCHED_DOC = doc(db, "state", "watched");

// In-memory cache of { [filmId]: true } — kept in sync with Firestore.
let watchedCache = {};
let ready = false;
const listeners = new Set();

function notify() {
  for (const fn of listeners) fn(watchedCache);
}

export function onWatchedChange(fn) {
  listeners.add(fn);
  if (ready) fn(watchedCache);
  return () => listeners.delete(fn);
}

export function isWatched(filmId) {
  return !!watchedCache[filmId];
}

export async function toggleWatched(filmId) {
  const next = !watchedCache[filmId];
  watchedCache = { ...watchedCache, [filmId]: next };
  if (!next) delete watchedCache[filmId];
  notify();
  try {
    await setDoc(WATCHED_DOC, watchedCache);
  } catch (e) {
    console.error("Failed to save watched state to Firebase:", e);
  }
}

// Live-sync across tabs/devices.
onSnapshot(
  WATCHED_DOC,
  (snap) => {
    watchedCache = snap.exists() ? snap.data() : {};
    ready = true;
    notify();
  },
  (err) => {
    console.error("Firestore sync error:", err);
    ready = true;
    notify();
  }
);

export async function ensureWatchedLoaded() {
  if (ready) return watchedCache;
  const snap = await getDoc(WATCHED_DOC);
  watchedCache = snap.exists() ? snap.data() : {};
  ready = true;
  return watchedCache;
}
