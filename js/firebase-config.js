// Firebase setup for Cinema Classics.
//
// The apiKey below is NOT a secret — Firebase web config is meant to be
// public (it just identifies the project). Actual access control lives in
// Firestore Security Rules (see /firestore.rules in this repo).
//
// Each person gets their own watched-list by visiting the site with their
// name as a bare query param, e.g. https://.../?maria — no "=" needed.
// With no name given, it defaults to "rui". Everyone shares the same
// films/oscars data and the same AI-generated analysis cache; only the
// watched-status document is per-person.

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

// ---------------------------------------------------------------- profile
function resolveProfileName() {
  const params = new URLSearchParams(location.search);
  const keys = [...params.keys()].filter(Boolean);
  const raw = (keys[0] || "rui").toLowerCase();
  const clean = raw.replace(/[^a-z0-9_-]/g, "").slice(0, 30);
  return clean || "rui";
}
export const PROFILE = resolveProfileName();

const WATCHED_DOC = doc(db, "state", PROFILE);

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

export async function setWatched(filmId, value) {
  watchedCache = { ...watchedCache };
  if (value) watchedCache[filmId] = true;
  else delete watchedCache[filmId];
  notify();
  try {
    await setDoc(WATCHED_DOC, watchedCache);
  } catch (e) {
    console.error("Failed to save watched state to Firebase:", e);
  }
}

export async function toggleWatched(filmId) {
  return setWatched(filmId, !watchedCache[filmId]);
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

// ---------------------------------------------------------------- shortlist
// "Want to watch" list — same shape and pattern as the watched list above,
// just a separate per-person document so the two stay independent.
const SHORTLIST_DOC = doc(db, "shortlist", PROFILE);
let shortlistCache = {};
let shortlistReady = false;
const shortlistListeners = new Set();

function notifyShortlist() {
  for (const fn of shortlistListeners) fn(shortlistCache);
}

export function onShortlistChange(fn) {
  shortlistListeners.add(fn);
  if (shortlistReady) fn(shortlistCache);
  return () => shortlistListeners.delete(fn);
}

export function isShortlisted(filmId) {
  return !!shortlistCache[filmId];
}

export async function setShortlisted(filmId, value) {
  shortlistCache = { ...shortlistCache };
  if (value) shortlistCache[filmId] = true;
  else delete shortlistCache[filmId];
  notifyShortlist();
  try {
    await setDoc(SHORTLIST_DOC, shortlistCache);
  } catch (e) {
    console.error("Failed to save shortlist to Firebase:", e);
  }
}

export async function toggleShortlisted(filmId) {
  return setShortlisted(filmId, !shortlistCache[filmId]);
}

onSnapshot(
  SHORTLIST_DOC,
  (snap) => {
    shortlistCache = snap.exists() ? snap.data() : {};
    shortlistReady = true;
    notifyShortlist();
  },
  (err) => {
    console.error("Firestore shortlist sync error:", err);
    shortlistReady = true;
    notifyShortlist();
  }
);

export async function ensureShortlistLoaded() {
  if (shortlistReady) return shortlistCache;
  const snap = await getDoc(SHORTLIST_DOC);
  shortlistCache = snap.exists() ? snap.data() : {};
  shortlistReady = true;
  return shortlistCache;
}

// ---------------------------------------------------------------- analysis
// Shared across everyone (not per-profile) — one AI-generated write-up per
// film, cached forever once generated so it's never paid for twice.
export async function getAnalysis(filmId) {
  try {
    const snap = await getDoc(doc(db, "analysis", filmId));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.error("Failed to read analysis from Firebase:", e);
    return null;
  }
}

export async function saveAnalysis(filmId, data) {
  await setDoc(doc(db, "analysis", filmId), { ...data, generated_at: Date.now() });
}
