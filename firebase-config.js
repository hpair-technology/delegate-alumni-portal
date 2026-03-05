// Client SDK config for browser usage (no imports needed here).
// app.js pulls this object and initializes Firebase using CDN modules.
//
// To use a different Firebase project (e.g. dev/staging/prod), set these
// in a .env file (see .env.example). Vite exposes env vars prefixed with VITE_.
const env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyDoxK8mf_341BcZWCLxjwt1iIMCHGbLWz0",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "alumni-portal-30642.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "alumni-portal-30642",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "alumni-portal-30642.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "180735084374",
  appId: env.VITE_FIREBASE_APP_ID || "1:180735084374:web:705a0bfb0fe78409e4b8f7",
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || "G-QHJ3PCD7MB",
};