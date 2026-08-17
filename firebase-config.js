// Client SDK config for browser usage (no imports needed here).
// app.js pulls this object and initializes Firebase using CDN modules.
//
// The defaults below are the live project. To point a local checkout at a
// different one (dev/staging, or a personal sandbox), copy .env.example to
// .env and fill in the values; Vite exposes anything prefixed with VITE_.
//
// Web API keys are public by design: they ship in the JS bundle of every
// Firebase site. Access is controlled by firestore.rules and storage.rules,
// and the key is referrer-restricted in Google Cloud.
const env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};

export const firebaseConfig = {
  apiKey:            env.VITE_FIREBASE_API_KEY             || "AIzaSyB_txgmYyrY4THmw9Ok7XYuYuewn63jf88",
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN         || "delegate-alumni-hpair.firebaseapp.com",
  projectId:         env.VITE_FIREBASE_PROJECT_ID          || "delegate-alumni-hpair",
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET      || "delegate-alumni-hpair.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "305990316816",
  appId:             env.VITE_FIREBASE_APP_ID              || "1:305990316816:web:713f6376ea79411b30ab95",
  measurementId:     env.VITE_FIREBASE_MEASUREMENT_ID      || "G-L21QM0NWHT",
};
