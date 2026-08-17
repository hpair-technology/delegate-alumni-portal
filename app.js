/* ============================================================================
   HPAIR Delegate Alumni Portal: application logic
   ----------------------------------------------------------------------------
   Data lives in Firestore. Every collection degrades gracefully to
   localStorage if Firestore is unreachable or blocked by security rules, so
   the portal keeps working (and says so) instead of silently failing.
   ========================================================================== */

import { firebaseConfig } from "./firebase-config.js?v=2";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, sendPasswordResetEmail, signOut, updateProfile,
  setPersistence, browserLocalPersistence, browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, deleteDoc, updateDoc,
  onSnapshot, collection, query, orderBy, limit, serverTimestamp, deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ─── Firebase init ────────────────────────────────────────────────────── */
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const storage = getStorage(app, firebaseConfig.storageBucket?.startsWith("gs://")
  ? firebaseConfig.storageBucket
  : `gs://${firebaseConfig.storageBucket}`);

/* Accounts that always get admin powers. Anyone else can be promoted by
   setting `role: "admin"` on their document in the `users` collection. */
const ADMIN_EMAILS = new Set(["tech-help@hpair.org", "finance@hpair.org"]);

const INDUSTRIES = [
  "Academia/Research",
  "Arts/Entertainment",
  "Engineering",
  "Entrepreneurship",
  "Financial Services (including Private Equity/Hedge Funds)",
  "Government/Politics",
  "Healthcare",
  "Law",
  "Management Consulting",
  "Media",
  "Non-Profit/Social Enterprise",
  "Technology",
];
const SHORT_INDUSTRY = { "Financial Services (including Private Equity/Hedge Funds)": "Financial Services" };

const REACTIONS = ["👍", "❤️", "🎉", "🙌", "😂"];

const QUESTION_TYPES = {
  short: "Short answer",
  long: "Long answer",
  select: "Multiple choice",
  checkbox: "Checkboxes",
  file: "File upload",
};

const OPP_META = {
  // HPAIR's own calls (hosting bids, partnerships, team roles) lead the list.
  HPAIR:       { color: "#A51C30", icon: "📣", chip: "chip-crimson", label: "HPAIR opportunity" },
  Job:         { color: "#0b6fa4", icon: "💼", chip: "chip-info" },
  Internship:  { color: "#12795e", icon: "🎓", chip: "chip-ok" },
  Fellowship:  { color: "#6d3fb5", icon: "🏛️", chip: "chip-crimson" },
  Scholarship: { color: "#a8690a", icon: "🎖️", chip: "chip-gold" },
  Resource:    { color: "#a8690a", icon: "📚", chip: "chip-gold" },
  Other:       { color: "#6b6b74", icon: "✨", chip: "" },
};

/* ─── Tiny DOM helpers ─────────────────────────────────────────────────── */
const $  = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Only allow navigable schemes, blocking `javascript:` and friends. */
function safeUrl(u) {
  const s = String(u ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s) || /^mailto:/i.test(s) || /^tel:/i.test(s)) return s;
  return "";
}
function safeImg(u) {
  const s = String(u ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s) || /^data:image\//i.test(s) || /^blob:/i.test(s)) return s;
  return "";
}

/**
 * Only Google Forms URLs are ever put in an <iframe>. An admin could paste any
 * link into the settings modal, so restrict framing to the one host we mean to
 * embed; anything else is still offered as a plain outbound link.
 */
function googleFormEmbedUrl(raw) {
  const s = safeUrl(raw);
  if (!s) return "";
  try {
    const url = new URL(s);
    if (url.protocol !== "https:") return "";
    if (url.hostname !== "docs.google.com") return "";
    if (!url.pathname.startsWith("/forms/")) return "";
    url.searchParams.set("embedded", "true");
    return url.toString();
  } catch { return ""; }
}

function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  const p = Date.parse(ts);
  return Number.isNaN(p) ? 0 : p;
}
function formatDate(ts) {
  const ms = toMillis(ts);
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function timeAgo(ts) {
  const ms = toMillis(ts);
  if (!ms) return "";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 7) return `${d}d ago`;
  return formatDate(ms);
}
function debounce(fn, ms = 220) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const AVATAR_COLORS = ["#a51c30", "#7a0e1c", "#1f3a5f", "#2f6f5e", "#8a5a12", "#5b3a7a", "#0f766e", "#9d3a52", "#3f5b2e"];
function avatarColor(seed) {
  let h = 0; const s = String(seed || "?");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name, email) {
  const src = String(name || "").trim() || String(email || "").split("@")[0] || "?";
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  const a = parts[0]?.[0] || "?";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase();
}
/** Avatar markup: photo if present, colored initials otherwise. */
function avatarHtml(user, cls = "avatar") {
  const url = safeImg(user?.headshotUrl);
  const label = user?.name || user?.authorName || user?.email || "Alum";
  if (url) return `<span class="${cls}"><img src="${esc(url)}" alt="" style="width:100%;height:100%;object-fit:cover;" loading="lazy"></span>`;
  return `<span class="${cls}" style="background:${avatarColor(label)}">${esc(initials(user?.name, user?.email))}</span>`;
}
function shortIndustry(i) { return SHORT_INDUSTRY[i] || i; }

/* ─── Toasts ───────────────────────────────────────────────────────────── */
const TOAST_ICON = { ok: "✓", error: "!", info: "i", warn: "!" };
function toast(message, kind = "ok", title = "") {
  const stack = $("toast-stack");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `
    <span class="t-ico" aria-hidden="true">${TOAST_ICON[kind] || "i"}</span>
    <span class="t-body">${title ? `<b>${esc(title)}</b>` : ""}${esc(message)}</span>
    <button class="t-close" type="button" aria-label="Dismiss">&times;</button>`;
  const kill = () => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 250);
  };
  el.querySelector(".t-close").addEventListener("click", kill);
  stack.appendChild(el);
  setTimeout(kill, kind === "error" ? 7000 : 4200);
  const live = $("live-region");
  if (live) live.textContent = message;
}

/* ─── Modals ───────────────────────────────────────────────────────────── */
const modalStack = [];
function openModal(id) {
  const el = $(id);
  if (!el || !el.hidden) return;
  el.dataset.returnFocus = document.activeElement?.id || "";
  el.hidden = false;
  modalStack.push(id);
  document.body.style.overflow = "hidden";
  const focusable = el.querySelector("input:not([type=hidden]):not([disabled]), textarea, select, button:not(.modal-close)");
  setTimeout(() => focusable?.focus(), 60);
}
function closeModal(id) {
  const el = $(id);
  if (!el || el.hidden) return;
  el.hidden = true;
  // A confirm dialog dismissed by Escape / backdrop counts as "no".
  if (id === "confirm-modal" && state.confirmResolve) { const r = state.confirmResolve; state.confirmResolve = null; r(false); }
  const i = modalStack.lastIndexOf(id);
  if (i >= 0) modalStack.splice(i, 1);
  if (!modalStack.length) document.body.style.overflow = "";
  const back = el.dataset.returnFocus && $(el.dataset.returnFocus);
  if (back) back.focus();
}
function closeTopModal() {
  if (modalStack.length) closeModal(modalStack[modalStack.length - 1]);
}
document.addEventListener("click", (e) => {
  const closer = e.target.closest("[data-close]");
  if (closer) {
    const m = closer.closest(".modal");
    if (m) { closeModal(m.id); return; }
  }
  if (e.target.classList?.contains("modal")) closeModal(e.target.id);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTopModal(); });

/** Promise-based replacement for window.confirm(). */
function confirmDialog(text, { title = "Are you sure?", confirmLabel = "Confirm" } = {}) {
  return new Promise((resolve) => {
    $("confirm-title").textContent = title;
    $("confirm-text").textContent = text;
    $("confirm-yes").textContent = confirmLabel;
    const finish = (v) => {
      $("confirm-yes").removeEventListener("click", yes);
      $("confirm-no").removeEventListener("click", no);
      resolve(v);
    };
    state.confirmResolve = finish;
    const answer = (v) => {
      state.confirmResolve = null;
      closeModal("confirm-modal");
      finish(v);
    };
    const yes = () => answer(true);
    const no  = () => answer(false);
    $("confirm-yes").addEventListener("click", yes);
    $("confirm-no").addEventListener("click", no);
    openModal("confirm-modal");
  });
}

/* ─── Connectivity state ───────────────────────────────────────────────── */
const net = { degraded: false, reason: "" };
function markDegraded(reason) {
  if (net.degraded) return;
  net.degraded = true;
  net.reason = reason || "";
  const bar = $("sysbar");
  if (bar) {
    $("sysbar-text").textContent =
      "Some data couldn't reach the cloud database. Those sections are saved to this browser only. Check your Firestore security rules.";
    bar.hidden = false;
  }
  const chat = $("chat-status");
  if (chat) { chat.textContent = "Local only"; chat.className = "chip chip-warn"; }
  console.warn("[portal] degraded to local mode:", reason);
}
$("sysbar-retry")?.addEventListener("click", () => location.reload());

/* ─── Store: a Firestore collection with a localStorage fallback ───────── */
class Col {
  constructor(name, { orderField = "createdAt", dir = "desc", max = 400 } = {}) {
    Object.assign(this, { name, orderField, dir, max });
    this.items = [];
    this.listeners = new Set();
    this.unsub = null;
    this.mode = "remote";
    this.started = false;
    this.ready = false;
  }
  get key() { return `hpair:${this.name}`; }

  onChange(fn) {
    this.listeners.add(fn);
    if (this.ready) fn(this.items);
    return () => this.listeners.delete(fn);
  }
  emit() {
    this.ready = true;
    this.listeners.forEach((fn) => { try { fn(this.items); } catch (e) { console.error(e); } });
  }

  localRead() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; } }
  localWrite(a) { try { localStorage.setItem(this.key, JSON.stringify(a)); } catch (e) { console.warn("localStorage full", e); } }
  sortLocal(a) {
    if (!this.orderField) return a;
    const s = [...a].sort((x, y) => toMillis(y[this.orderField]) - toMillis(x[this.orderField]));
    return this.dir === "asc" ? s.reverse() : s;
  }

  start() {
    if (this.started) return;
    this.started = true;
    if (net.degraded) return this.goLocal("already degraded");
    try {
      const base = collection(db, this.name);
      const qy = this.orderField
        ? query(base, orderBy(this.orderField, this.dir), limit(this.max))
        : query(base, limit(this.max));
      this.unsub = onSnapshot(qy,
        (snap) => {
          this.mode = "remote";
          this.items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          this.emit();
        },
        (err) => this.goLocal(err));
    } catch (err) { this.goLocal(err); }
  }
  stop() {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    this.started = false; this.ready = false; this.items = [];
  }

  goLocal(err) {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    this.mode = "local";
    markDegraded(err?.code || err?.message || String(err));
    // Preserve anything we already fetched so the UI doesn't blank out.
    const local = this.localRead();
    if (!local.length && this.items.length) {
      this.localWrite(this.items.map((it) => ({ ...it, createdAt: toMillis(it.createdAt) || Date.now(), updatedAt: toMillis(it.updatedAt) || Date.now() })));
    }
    this.items = this.sortLocal(this.localRead());
    this.emit();
  }

  async add(data, id = null) {
    if (this.mode === "remote") {
      try {
        const payload = { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
        if (id) { await setDoc(doc(db, this.name, id), payload); return id; }
        const r = await addDoc(collection(db, this.name), payload);
        return r.id;
      } catch (err) { this.goLocal(err); }
    }
    const newId = id || `loc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const arr = this.localRead().filter((x) => x.id !== newId);
    arr.push({ ...data, id: newId, createdAt: Date.now(), updatedAt: Date.now() });
    this.localWrite(arr);
    this.items = this.sortLocal(arr);
    this.emit();
    return newId;
  }

  async update(id, data) {
    if (this.mode === "remote" && !String(id).startsWith("loc_")) {
      try { await updateDoc(doc(db, this.name, id), { ...data, updatedAt: serverTimestamp() }); return; }
      catch (err) { this.goLocal(err); }
    }
    const arr = this.localRead().map((x) => (x.id === id ? { ...x, ...data, updatedAt: Date.now() } : x));
    this.localWrite(arr);
    this.items = this.sortLocal(arr);
    this.emit();
  }

  async remove(id) {
    if (this.mode === "remote" && !String(id).startsWith("loc_")) {
      try { await deleteDoc(doc(db, this.name, id)); return; }
      catch (err) { this.goLocal(err); }
    }
    const arr = this.localRead().filter((x) => x.id !== id);
    this.localWrite(arr);
    this.items = this.sortLocal(arr);
    this.emit();
  }
}

/** A single Firestore document with the same local fallback behavior. */
class Docu {
  constructor(path, fallback = {}) {
    this.path = path; this.fallback = fallback;
    this.data = null; this.listeners = new Set();
    this.unsub = null; this.mode = "remote"; this.started = false;
  }
  get key() { return `hpair:${this.path.replace(/\//g, ":")}`; }
  onChange(fn) { this.listeners.add(fn); if (this.data) fn(this.data); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((fn) => { try { fn(this.data); } catch (e) { console.error(e); } }); }
  localRead() { try { return JSON.parse(localStorage.getItem(this.key)) || { ...this.fallback }; } catch { return { ...this.fallback }; } }

  start() {
    if (this.started) return;
    this.started = true;
    if (net.degraded) return this.goLocal("already degraded");
    const [c, d] = this.path.split("/");
    try {
      this.unsub = onSnapshot(doc(db, c, d),
        (snap) => { this.mode = "remote"; this.data = snap.exists() ? snap.data() : { ...this.fallback }; this.emit(); },
        (err) => this.goLocal(err));
    } catch (err) { this.goLocal(err); }
  }
  stop() { if (this.unsub) { this.unsub(); this.unsub = null; } this.started = false; this.data = null; }
  goLocal(err) {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    this.mode = "local"; markDegraded(err?.code || err?.message || String(err));
    this.data = this.localRead(); this.emit();
  }
  async write(data) {
    if (this.mode === "remote") {
      const [c, d] = this.path.split("/");
      try { await setDoc(doc(db, c, d), { ...data, updatedAt: serverTimestamp() }, { merge: true }); return; }
      catch (err) { this.goLocal(err); }
    }
    this.data = { ...this.data, ...data };
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch {}
    this.emit();
  }
}

const Users        = new Col("users", { orderField: null });
const Presence     = new Col("presence", { orderField: null });
const Opportunities= new Col("opportunities");
const Milestones   = new Col("milestones");
// Newest-first from the server (so the limit keeps the *latest* messages),
// then reversed for display.
const Messages     = new Col("community_messages", { orderField: "createdAt", dir: "desc", max: 250 });
const Submissions  = new Col("ambassador_submissions");
const Photos       = new Col("library_photos");
const AmbConfig    = new Docu("config/ambassador", { open: true, questions: [] });
// Google Form links are configured by an admin in the portal rather than
// hardcoded, so they can be swapped per conference without a redeploy.
const FormsConfig  = new Docu("config/forms", { feedbackUrl: "" });

/* ─── App state ────────────────────────────────────────────────────────── */
const state = {
  user: null,        // Firebase user
  profile: {},       // users/{uid} document
  isAdmin: false,
  tab: "alumni",
  onlineUids: new Set(),
  croppedBlob: null,
  cropper: null,
  editingOpp: null,
  editingMs: null,
  mySubmission: null,
};

/* ─── File uploads (Storage, with a data-URL fallback) ─────────────────── */
async function uploadFile(path, blob, { allowInline = false } = {}) {
  try {
    const r = ref(storage, path);
    await uploadBytes(r, blob);
    return await getDownloadURL(r);
  } catch (err) {
    console.warn("[storage] upload failed:", err?.code || err);
    // Small images can still be stored inline so the feature keeps working.
    if (allowInline && blob.size < 700 * 1024 && String(blob.type).startsWith("image/")) {
      return await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
    }
    throw new Error("Upload failed. Check your connection or Firebase Storage rules.");
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   AUTH
   ══════════════════════════════════════════════════════════════════════ */
const authView = $("auth-view");
const appView  = $("app-view");

function authAlert(msg, kind = "error") {
  const el = $("auth-alert");
  if (!el) return;
  if (!msg) { el.hidden = true; el.textContent = ""; return; }
  el.className = `alert ${kind}`;
  el.textContent = msg;
  el.hidden = false;
}

const AUTH_ERRORS = {
  "auth/invalid-email": "That doesn't look like a valid email address.",
  "auth/user-disabled": "This account has been disabled. Contact tech-help@hpair.org.",
  "auth/user-not-found": "No account found for that email. Create one first.",
  "auth/wrong-password": "Incorrect password. Try again or reset it.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/invalid-login-credentials": "Incorrect email or password.",
  "auth/too-many-requests": "Too many attempts. Wait a moment, or reset your password.",
  "auth/email-already-in-use": "That email is already registered. Log in instead.",
  "auth/weak-password": "Please choose a password of at least 6 characters.",
  "auth/network-request-failed": "Network problem. Check your connection and try again.",
  "auth/operation-not-allowed": "Email/password sign-in is not enabled on this Firebase project.",
};
const authMessage = (err) => AUTH_ERRORS[err?.code] || err?.message?.replace(/^Firebase:\s*/, "") || "Something went wrong.";

/** Alumni allowlist (delegate_alumni_portal.csv, one email per line). */
let allowlistCache = null;
async function loadAllowlist() {
  if (allowlistCache) return allowlistCache;
  // Absolute, not "./": this page is served at /portal, and a relative fetch
  // would break the moment a host resolves that with a trailing slash.
  const res = await fetch("/delegate_alumni_portal.csv", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load the alumni allowlist. Make sure the site is served over http:// and not opened as a file.");
  const text = await res.text();
  allowlistCache = new Set(
    text.split(/\r?\n/)
      .map((line) => line.split(",")[0].trim().toLowerCase())
      .filter((v) => v.includes("@")));
  return allowlistCache;
}

/* --- tab switching on the auth card --- */
function showAuthPanel(which) {
  const login = which === "login";
  $("tab-login").setAttribute("aria-selected", String(login));
  $("tab-register").setAttribute("aria-selected", String(!login));
  $("panel-login").classList.toggle("active", login);
  $("panel-register").classList.toggle("active", !login);
  authAlert("");
}
$("tab-login").addEventListener("click", () => showAuthPanel("login"));
$("tab-register").addEventListener("click", () => showAuthPanel("register"));
$$("[data-goto]").forEach((b) => b.addEventListener("click", () => showAuthPanel(b.dataset.goto)));

/* --- password reveal toggles --- */
$$("[data-reveal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = $(btn.dataset.reveal);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.textContent = show ? "Hide" : "Show";
  });
});

/* --- password strength --- */
$("register-password").addEventListener("input", (e) => {
  const v = e.target.value;
  let score = 0;
  if (v.length >= 6) score++;
  if (v.length >= 10) score++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
  if (/\d/.test(v) || /[^\w\s]/.test(v)) score++;
  if (!v) score = 0;
  $("pw-meter").dataset.score = String(score);
  $("pw-note").textContent = !v
    ? "Use at least 6 characters. Longer passphrases are stronger."
    : ["Too short", "Weak, add more characters", "Fair", "Good", "Strong"][score];
});

/* --- register --- */
$("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  authAlert("");
  const btn = e.target.querySelector('button[type="submit"]');
  const email = $("register-email").value.trim().toLowerCase();
  const password = $("register-password").value;
  const name = $("register-name").value.trim();
  if (password.length < 6) return authAlert("Password must be at least 6 characters.");

  btn.disabled = true;
  const label = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Creating account…';
  try {
    const allowlist = await loadAllowlist();
    if (!allowlist.has(email)) {
      authAlert("That email isn't on the HPAIR alumni allowlist. Email tech-help@hpair.org to be added.");
      return;
    }
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (name) { try { await updateProfile(cred.user, { displayName: name }); } catch {} }
    try {
      await setDoc(doc(db, "users", cred.user.uid), {
        email, name, gradYear: "", headshotUrl: "", bio: "", industries: [],
        title: "", company: "", location: "", linkedin: "", role: "",
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    } catch (err) { console.warn("Could not create profile doc:", err); }
    toast("Welcome to the portal!", "ok", "Account created");
  } catch (err) {
    authAlert(authMessage(err));
  } finally {
    btn.disabled = false;
    btn.innerHTML = label;
  }
});

/* --- login --- */
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  authAlert("");
  const btn = e.target.querySelector('button[type="submit"]');
  const email = $("login-email").value.trim().toLowerCase();
  const password = $("login-password").value;
  btn.disabled = true;
  const label = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Signing in…';
  try {
    await setPersistence(auth, $("login-remember").checked ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    authAlert(authMessage(err));
  } finally {
    btn.disabled = false;
    btn.innerHTML = label;
  }
});

/* --- forgot password --- */
$("forgot-link").addEventListener("click", () => {
  $("forgot-email").value = $("login-email").value.trim();
  $("forgot-alert").hidden = true;
  openModal("forgot-modal");
});
$("forgot-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const box = $("forgot-alert");
  const email = $("forgot-email").value.trim().toLowerCase();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await sendPasswordResetEmail(auth, email);
    box.className = "alert ok";
    box.textContent = "Done. If an account exists for that address, a reset link is on its way. Check your spam folder too.";
    box.hidden = false;
  } catch (err) {
    // Don't reveal whether the address exists.
    if (err?.code === "auth/user-not-found") {
      box.className = "alert ok";
      box.textContent = "Done. If an account exists for that address, a reset link is on its way.";
    } else {
      box.className = "alert error";
      box.textContent = authMessage(err);
    }
    box.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

/* --- logout --- */
async function doLogout() {
  try {
    await setPresenceOffline();
    await signOut(auth);
    toast("Signed out.", "info");
  } catch { toast("Could not sign out.", "error"); }
}
$("menu-logout").addEventListener("click", doLogout);

/* --- auth state --- */
onAuthStateChanged(auth, async (user) => {
  if (user) {
    state.user = user;
    await enterApp();
  } else {
    state.user = null;
    exitApp();
  }
});

async function enterApp() {
  authView.hidden = true;
  appView.hidden = false;
  document.body.style.overflow = "";

  // Load (or create) the profile document.
  try {
    const snap = await getDoc(doc(db, "users", state.user.uid));
    state.profile = snap.exists() ? snap.data() : {};
    if (!snap.exists()) {
      await setDoc(doc(db, "users", state.user.uid), {
        email: state.user.email, name: state.user.displayName || "",
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }, { merge: true });
      state.profile = { email: state.user.email, name: state.user.displayName || "" };
    }
  } catch (err) {
    console.warn("Profile load failed:", err);
    state.profile = { email: state.user.email, name: state.user.displayName || "" };
    markDegraded(err?.code || err);
  }

  state.isAdmin = ADMIN_EMAILS.has((state.user.email || "").toLowerCase()) || state.profile.role === "admin";
  $$(".admin-only").forEach((el) => { el.hidden = !state.isAdmin; });
  $("admin-badge-wrap").hidden = !state.isAdmin;

  paintIdentity();
  startData();
  showTab(location.hash.replace("#", "") || "alumni");
  setPresenceOnline();
}

function exitApp() {
  appView.hidden = true;
  authView.hidden = false;
  stopData();
  state.profile = {};
  state.isAdmin = false;
  $("login-password").value = "";
  $("register-password").value = "";
}

function paintIdentity() {
  const me = { ...state.profile, email: state.user.email };
  const display = me.name || me.email;
  $("user-avatar").outerHTML = avatarHtml(me, "avatar").replace('class="avatar"', 'class="avatar" id="user-avatar"');
  $("user-name-short").textContent = me.name || me.email.split("@")[0];
  $("user-display-name").textContent = display;
  $("user-email").textContent = me.email;
  const first = String(me.name || "").trim().split(/\s+/)[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  $("hero-greeting").textContent = first ? `${greet}, ${first}.` : "Welcome back.";
}

/* ─── Presence ─────────────────────────────────────────────────────────── */
let heartbeat = null;
async function setPresenceOnline() {
  if (!state.user) return;
  const write = async () => {
    try {
      await setDoc(doc(db, "presence", state.user.uid), {
        email: state.user.email,
        name: state.profile.name || "",
        headshotUrl: state.profile.headshotUrl || "",
        status: "online",
        lastSeen: serverTimestamp(),
      }, { merge: true });
    } catch (err) { console.warn("presence write failed:", err?.code || err); }
  };
  await write();
  clearInterval(heartbeat);
  heartbeat = setInterval(write, 60_000);
}
async function setPresenceOffline() {
  clearInterval(heartbeat);
  if (!state.user) return;
  try {
    await setDoc(doc(db, "presence", state.user.uid), { status: "offline", lastSeen: serverTimestamp() }, { merge: true });
  } catch {}
}
window.addEventListener("pagehide", () => { if (state.user) setPresenceOffline(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.user) setPresenceOnline();
});

const ONLINE_WINDOW = 5 * 60 * 1000;
function recomputeOnline(rows) {
  const now = Date.now();
  state.onlineUids = new Set(
    rows.filter((p) => p.status === "online" && now - toMillis(p.lastSeen) < ONLINE_WINDOW).map((p) => p.id));
  if (state.user) state.onlineUids.add(state.user.uid);
  renderOnline();
}

function renderOnline() {
  const people = Array.from(state.onlineUids)
    .map((uid) => Users.items.find((u) => u.id === uid) || Presence.items.find((p) => p.id === uid))
    .filter(Boolean);

  const strip = $("online-strip");
  const avatars = $("online-avatars");
  if (strip && avatars) {
    strip.hidden = people.length === 0;
    avatars.innerHTML = people.slice(0, 7).map((p) => avatarHtml(p)).join("")
      + (people.length > 7 ? `<span class="more">+${people.length - 7}</span>` : "");
  }
  const list = $("online-list");
  if (list) {
    list.innerHTML = people.length
      ? people.map((p) => `<div class="online-item">${avatarHtml(p)}<span class="oi-name">${esc(p.name || p.email || "Alum")}${p.id === state.user?.uid ? " (you)" : ""}</span></div>`).join("")
      : `<p class="help">Nobody else is online right now.</p>`;
  }
  const inline = $("online-count-inline");
  if (inline) inline.textContent = people.length ? `· ${people.length}` : "";
  $("stat-online").textContent = String(people.length);
}

/* ══════════════════════════════════════════════════════════════════════════
   TABS
   ══════════════════════════════════════════════════════════════════════ */
function showTab(name) {
  const valid = ["alumni", "career", "milestones", "conference", "community", "ambassador"];
  if (!valid.includes(name)) name = "alumni";
  state.tab = name;
  $$(".tab-btn").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  $$(".tab-panel").forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
  history.replaceState(null, "", `#${name}`);
  if (name === "community") {
    setTimeout(() => { const f = $("community-feed"); if (f) f.scrollTop = f.scrollHeight; }, 60);
    $("message-input")?.focus();
  }
}
$$(".tab-btn").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

/* ─── User menu ────────────────────────────────────────────────────────── */
const um = $("usermenu");
$("usermenu-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const open = um.classList.toggle("open");
  $("usermenu-btn").setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", () => {
  um.classList.remove("open");
  $("usermenu-btn").setAttribute("aria-expanded", "false");
});
$("menu-profile").addEventListener("click", () => openProfileModal());

/* ══════════════════════════════════════════════════════════════════════════
   DATA WIRING
   ══════════════════════════════════════════════════════════════════════ */
const unsubs = [];
function startData() {
  stopData();   // idempotent: never stack duplicate listeners
  [Users, Presence, Opportunities, Milestones, Messages, Photos].forEach((c) => c.start());
  AmbConfig.start();
  FormsConfig.start();
  if (state.isAdmin) Submissions.start();
  else loadMySubmission();

  unsubs.push(
    Users.onChange(() => { renderDirectory(); renderOnline(); $("stat-alumni").textContent = String(Users.items.length); $("count-alumni").textContent = String(Users.items.length); }),
    Presence.onChange(recomputeOnline),
    Opportunities.onChange(renderOpportunities),
    Milestones.onChange(renderMilestones),
    Messages.onChange(renderMessages),
    AmbConfig.onChange(renderAmbassador),
    Photos.onChange(renderPhotos),
    FormsConfig.onChange(renderFormsConfig),
    Submissions.onChange((rows) => { $("count-submissions").textContent = String(rows.length); renderSubmissions(); }),
  );
}
function stopData() {
  unsubs.splice(0).forEach((fn) => fn());
  [Users, Presence, Opportunities, Milestones, Messages, Submissions, Photos].forEach((c) => c.stop());
  AmbConfig.stop();
  FormsConfig.stop();
  clearInterval(heartbeat);
}

/* ══════════════════════════════════════════════════════════════════════════
   ALUMNI DIRECTORY
   ══════════════════════════════════════════════════════════════════════ */
const filters = { name: "", year: "", industry: "", sort: "name" };

let industrySignature = "";
function populateIndustryOptions() {
  const sel = $("search-industry");
  const seen = new Set(INDUSTRIES);
  Users.items.forEach((u) => (u.industries || []).forEach((i) => seen.add(i)));
  const list = Array.from(seen).sort();
  const signature = list.join("|");
  // Only rebuild when the option set actually changes, otherwise typing in
  // the search box would keep closing this dropdown.
  if (signature !== industrySignature) {
    industrySignature = signature;
    const current = sel.value;
    sel.innerHTML = `<option value="">All industries</option>` +
      list.map((i) => `<option value="${esc(i)}">${esc(shortIndustry(i))}</option>`).join("");
    sel.value = current;
  }

  const grid = $("profile-industries");
  if (grid && !grid.children.length) {
    grid.innerHTML = INDUSTRIES.map((i) =>
      `<label class="check"><input type="checkbox" value="${esc(i)}"> ${esc(shortIndustry(i))}</label>`).join("");
  }
}

$("search-name").addEventListener("input", debounce((e) => { filters.name = e.target.value.trim().toLowerCase(); renderDirectory(); }));
$("search-year").addEventListener("input", debounce((e) => { filters.year = e.target.value.trim(); renderDirectory(); }));
$("search-industry").addEventListener("change", (e) => { filters.industry = e.target.value; renderDirectory(); });
$("sort-by").addEventListener("change", (e) => { filters.sort = e.target.value; renderDirectory(); });
$("clear-filters").addEventListener("click", () => {
  filters.name = ""; filters.year = ""; filters.industry = "";
  $("search-name").value = ""; $("search-year").value = ""; $("search-industry").value = "";
  renderDirectory();
});

function renderDirectory() {
  const box = $("registered-body");
  if (!box) return;
  populateIndustryOptions();

  if (!Users.ready) {
    box.innerHTML = Array.from({ length: 6 }, () => `<div class="skeleton sk-card"></div>`).join("");
    return;
  }

  let list = Users.items.filter((u) => u.email);
  const q = filters.name;
  if (q) {
    list = list.filter((u) =>
      [u.name, u.email, u.company, u.title, u.location].filter(Boolean).join(" ").toLowerCase().includes(q));
  }
  if (filters.year) list = list.filter((u) => String(u.gradYear || "") === filters.year);
  if (filters.industry) list = list.filter((u) => (u.industries || []).includes(filters.industry));

  const online = state.onlineUids;
  list.sort((a, b) => {
    switch (filters.sort) {
      case "recent": return toMillis(b.createdAt) - toMillis(a.createdAt);
      case "year":   return (Number(b.gradYear) || 0) - (Number(a.gradYear) || 0);
      case "online": {
        const d = (online.has(b.id) ? 1 : 0) - (online.has(a.id) ? 1 : 0);
        if (d) return d;
        break;
      }
    }
    return String(a.name || a.email).localeCompare(String(b.name || b.email), undefined, { sensitivity: "base" });
  });

  const active = Boolean(q || filters.year || filters.industry);
  $("clear-filters").hidden = !active;
  $("directory-count").innerHTML = Users.items.length
    ? `Showing <b>${list.length}</b> of <b>${Users.items.length}</b> alumni`
    : "";

  if (!list.length) {
    box.innerHTML = `<div class="empty" style="grid-column:1/-1;">
      <div class="e-ico">${active ? "🔍" : "🌏"}</div>
      <h4>${active ? "No alumni match those filters" : "Nobody has joined yet"}</h4>
      <p>${active ? "Try a different name, year or industry." : "As delegates create their accounts they'll appear here."}</p>
      ${active ? '<button class="btn btn-ghost" type="button" onclick="document.getElementById(\'clear-filters\').click()">Clear filters</button>' : ""}
    </div>`;
    return;
  }

  box.innerHTML = list.map((u) => {
    const inds = (u.industries || []).slice(0, 2);
    const extra = (u.industries || []).length - inds.length;
    const photo = safeImg(u.headshotUrl);
    const roleLine = [u.title, u.company].filter(Boolean).join(" · ");
    return `
    <article class="person" tabindex="0" role="button" data-uid="${esc(u.id)}" aria-label="View ${esc(u.name || u.email)}'s profile">
      <div class="person-photo">
        ${photo
          ? `<img src="${esc(photo)}" alt="" loading="lazy">`
          : `<span class="ph-fallback" style="background:${avatarColor(u.name || u.email)}">${esc(initials(u.name, u.email))}</span>`}
        ${u.gradYear ? `<span class="ph-year">Class of ${esc(String(u.gradYear))}</span>` : ""}
        ${online.has(u.id) ? `<span class="ph-online">Online</span>` : ""}
        <p class="ph-name">${esc(u.name || u.email.split("@")[0])}</p>
      </div>
      <div class="person-body">
        ${roleLine ? `<p class="p-role">${esc(roleLine)}</p>` : `<p class="p-role" style="color:var(--ink-faint)">${esc(u.email)}</p>`}
        ${u.location ? `<p class="p-loc"><span aria-hidden="true">📍</span> ${esc(u.location)}</p>` : ""}
        ${inds.length ? `<div class="p-chips">${inds.map((i) => `<span class="chip chip-crimson">${esc(shortIndustry(i))}</span>`).join("")}${extra > 0 ? `<span class="chip">+${extra}</span>` : ""}</div>` : ""}
        <span class="p-view">View profile <span aria-hidden="true">→</span></span>
      </div>
    </article>`;
  }).join("");
}

$("registered-body").addEventListener("click", (e) => {
  const card = e.target.closest(".person");
  if (card) openPersonModal(card.dataset.uid);
});
$("registered-body").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const card = e.target.closest(".person");
  if (card) { e.preventDefault(); openPersonModal(card.dataset.uid); }
});

function openPersonModal(uid) {
  const u = Users.items.find((x) => x.id === uid);
  if (!u) return toast("That profile isn't available.", "error");

  $("detail-avatar").outerHTML = avatarHtml(u, "avatar").replace('class="avatar"', 'class="avatar" id="detail-avatar"');
  $("detail-name").textContent = u.name || u.email.split("@")[0];
  $("detail-role").textContent = [u.title, u.company].filter(Boolean).join(" · ");
  $("detail-role").hidden = !$("detail-role").textContent;
  $("detail-email").textContent = u.email || "";

  const meta = [];
  if (u.gradYear) meta.push(`<span class="chip chip-crimson">Class of ${esc(String(u.gradYear))}</span>`);
  if (u.location) meta.push(`<span class="chip">📍 ${esc(u.location)}</span>`);
  if (state.onlineUids.has(u.id)) meta.push(`<span class="chip chip-ok">● Online now</span>`);
  $("detail-meta").innerHTML = meta.join("");

  const bio = $("detail-bio");
  bio.textContent = u.bio || "";
  bio.hidden = !u.bio;

  const inds = u.industries || [];
  $("detail-industries-wrap").hidden = !inds.length;
  $("detail-industries").innerHTML = inds.map((i) => `<span class="chip chip-gold">${esc(shortIndustry(i))}</span>`).join("");

  const actions = [];
  const li = safeUrl(u.linkedin);
  if (li) actions.push(`<a class="btn btn-ghost" href="${esc(li)}" target="_blank" rel="noopener">LinkedIn ↗</a>`);
  if (u.email) actions.push(`<a class="btn btn-primary" href="mailto:${esc(u.email)}">Get in touch</a>`);
  if (u.id === state.user?.uid) actions.push(`<button type="button" class="btn btn-ghost" id="detail-edit-me">Edit my profile</button>`);
  $("detail-actions").innerHTML = actions.join("");
  $("detail-edit-me")?.addEventListener("click", () => { closeModal("user-detail-modal"); openProfileModal(); });

  openModal("user-detail-modal");
}

/* ══════════════════════════════════════════════════════════════════════════
   PROFILE EDITING
   ══════════════════════════════════════════════════════════════════════ */
function profileCompleteness(p) {
  const checks = [p.name, p.gradYear, p.headshotUrl, p.bio, (p.industries || []).length, p.title || p.company, p.location, p.linkedin];
  const done = checks.filter(Boolean).length;
  return Math.round((done / checks.length) * 100);
}
function paintCompleteness(p) {
  const pct = profileCompleteness(p);
  $("completeness-bar").style.width = `${pct}%`;
  $("completeness-pct").textContent = `${pct}%`;
}

function openProfileModal() {
  const p = state.profile || {};
  populateIndustryOptions();
  $("profile-name").value = p.name || "";
  $("profile-year").value = p.gradYear || "";
  $("profile-role").value = p.title || "";
  $("profile-company").value = p.company || "";
  $("profile-location").value = p.location || "";
  $("profile-linkedin").value = p.linkedin || "";
  $("profile-bio").value = p.bio || "";
  $("bio-count").textContent = String((p.bio || "").length);

  const chosen = p.industries || [];
  const known = INDUSTRIES;
  $$("#profile-industries input").forEach((cb) => { cb.checked = chosen.includes(cb.value); });
  const custom = chosen.find((i) => !known.includes(i));
  $("other-checkbox").checked = Boolean(custom);
  $("other-text").disabled = !custom;
  $("other-text").value = custom || "";

  $("profile-avatar-preview").outerHTML = avatarHtml({ ...p, email: state.user.email }, "avatar")
    .replace('class="avatar"', 'class="avatar" id="profile-avatar-preview" style="width:52px;height:52px;font-size:1.1rem;"');
  paintCompleteness(p);
  state.croppedBlob = null;
  openModal("profile-modal");
}

$("profile-bio").addEventListener("input", (e) => { $("bio-count").textContent = String(e.target.value.length); });
$("other-checkbox").addEventListener("change", (e) => {
  $("other-text").disabled = !e.target.checked;
  if (!e.target.checked) $("other-text").value = "";
  else $("other-text").focus();
});

/* --- headshot crop --- */
$("profile-headshot").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) { toast("Please choose an image file.", "error"); e.target.value = ""; return; }
  if (file.size > 12 * 1024 * 1024) { toast("That image is larger than 12 MB.", "error"); e.target.value = ""; return; }
  if (typeof Cropper === "undefined") { toast("Image cropper is still loading. Try again in a second.", "warn"); return; }
  const reader = new FileReader();
  reader.onload = () => {
    $("crop-image").src = reader.result;
    openModal("crop-modal");
    state.cropper?.destroy();
    state.cropper = new Cropper($("crop-image"), { aspectRatio: 1, viewMode: 1, autoCropArea: 1, background: false });
  };
  reader.readAsDataURL(file);
});
$("crop-save").addEventListener("click", () => {
  if (!state.cropper) return;
  state.cropper.getCroppedCanvas({ width: 600, height: 600, imageSmoothingQuality: "high" })
    .toBlob((blob) => {
      state.croppedBlob = blob;
      const url = URL.createObjectURL(blob);
      const el = $("profile-avatar-preview");
      el.innerHTML = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover;">`;
      el.style.background = "none";
      closeModal("crop-modal");
      state.cropper.destroy(); state.cropper = null;
    }, "image/jpeg", 0.9);
});
$("crop-cancel").addEventListener("click", () => {
  closeModal("crop-modal");
  state.cropper?.destroy(); state.cropper = null;
  state.croppedBlob = null;
  $("profile-headshot").value = "";
});

$("profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.user) return;
  const btn = $("profile-save");
  btn.disabled = true;
  const label = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Saving…';

  try {
    const industries = $$("#profile-industries input:checked").map((cb) => cb.value);
    const other = $("other-text").value.trim();
    if ($("other-checkbox").checked && other) industries.push(other);

    const update = {
      name: $("profile-name").value.trim(),
      gradYear: $("profile-year").value ? Number($("profile-year").value) : "",
      title: $("profile-role").value.trim(),   // job title; `role` is reserved for permissions
      company: $("profile-company").value.trim(),
      location: $("profile-location").value.trim(),
      linkedin: safeUrl($("profile-linkedin").value.trim()),
      bio: $("profile-bio").value.trim(),
      industries,
      updatedAt: serverTimestamp(),
    };

    if (state.croppedBlob) {
      if (state.croppedBlob.size > 5 * 1024 * 1024) throw new Error("That headshot is too large (max 5 MB).");
      update.headshotUrl = await uploadFile(`headshots/${state.user.uid}`, state.croppedBlob, { allowInline: true });
    }

    await setDoc(doc(db, "users", state.user.uid), update, { merge: true });
    state.profile = { ...state.profile, ...update, updatedAt: Date.now() };
    if (update.name) { try { await updateProfile(state.user, { displayName: update.name }); } catch {} }

    paintIdentity();
    paintCompleteness(state.profile);
    setPresenceOnline();
    state.croppedBlob = null;
    $("profile-headshot").value = "";
    closeModal("profile-modal");
    toast("Your profile is up to date.", "ok", "Saved");
  } catch (err) {
    console.error(err);
    toast(err.message || "Could not save your profile.", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = label;
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   CAREER HUB
   ══════════════════════════════════════════════════════════════════════ */
const oppFilters = { q: "", type: "", status: "open" };
$("opp-search").addEventListener("input", debounce((e) => { oppFilters.q = e.target.value.trim().toLowerCase(); renderOpportunities(); }));
$("opp-filter-type").addEventListener("change", (e) => { oppFilters.type = e.target.value; renderOpportunities(); });
$("opp-filter-status").addEventListener("change", (e) => { oppFilters.status = e.target.value; renderOpportunities(); });

const isExpired = (o) => Boolean(o.deadline) && o.deadline < new Date().toISOString().slice(0, 10);

$("post-opportunity-btn").addEventListener("click", () => openOppModal());
$("opp-file").addEventListener("change", (e) => {
  $("opp-file-name").textContent = e.target.files?.[0]?.name || "Attach a PDF or image";
});

function openOppModal(existing = null) {
  state.editingOpp = existing;
  $("opportunity-title").textContent = existing ? "Edit opportunity" : "Post an opportunity";
  $("opp-submit").textContent = existing ? "Save changes" : "Post opportunity";
  $("opp-id").value = existing?.id || "";
  $("opp-title").value = existing?.title || "";
  $("opp-org").value = existing?.org || "";
  $("opp-type").value = existing?.type || "Job";
  $("opp-location").value = existing?.location || "";
  $("opp-deadline").value = existing?.deadline || "";
  $("opp-desc").value = existing?.description || "";
  $("opp-link").value = existing?.link || "";
  $("opp-file").value = "";
  $("opp-file-name").textContent = existing?.fileName || "Attach a PDF or image";
  openModal("opportunity-modal");
}

$("opportunity-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("opp-submit");
  const link = $("opp-link").value.trim();
  if (link && !safeUrl(link)) return toast("The application link must start with http:// or https://", "error");

  btn.disabled = true;
  const label = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span> Saving…';
  try {
    const data = {
      title: $("opp-title").value.trim(),
      org: $("opp-org").value.trim(),
      type: $("opp-type").value,
      location: $("opp-location").value.trim(),
      deadline: $("opp-deadline").value || "",
      description: $("opp-desc").value.trim(),
      link: safeUrl(link),
    };
    const file = $("opp-file").files?.[0];
    if (file) {
      if (file.size > 8 * 1024 * 1024) throw new Error("Attachments must be under 8 MB.");
      data.fileUrl = await uploadFile(`opportunities/${state.user.uid}/${Date.now()}_${file.name}`, file, { allowInline: true });
      data.fileName = file.name;
    }

    if (state.editingOpp) {
      await Opportunities.update(state.editingOpp.id, data);
      toast("Opportunity updated.", "ok");
    } else {
      await Opportunities.add({
        ...data,
        posterUid: state.user.uid,
        posterEmail: state.user.email,
        posterName: state.profile.name || state.user.email,
        posterPhoto: state.profile.headshotUrl || "",
      });
      toast("Your opportunity is live.", "ok", "Posted");
    }
    closeModal("opportunity-modal");
    $("opportunity-form").reset();
    state.editingOpp = null;
  } catch (err) {
    toast(err.message || "Could not save the opportunity.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

function renderOpportunities() {
  const box = $("opportunities-list");
  if (!box) return;
  if (!Opportunities.ready) {
    box.innerHTML = Array.from({ length: 3 }, () => `<div class="skeleton sk-row"></div>`).join("");
    return;
  }

  let list = [...Opportunities.items];
  const openCount = list.filter((o) => !isExpired(o)).length;
  $("count-career").textContent = String(openCount);
  $("stat-opps").textContent = String(openCount);

  if (oppFilters.status === "open") list = list.filter((o) => !isExpired(o));
  if (oppFilters.status === "mine") list = list.filter((o) => o.posterUid === state.user?.uid);
  if (oppFilters.type) list = list.filter((o) => o.type === oppFilters.type);
  if (oppFilters.q) {
    list = list.filter((o) => [o.title, o.org, o.description, o.location, o.type]
      .filter(Boolean).join(" ").toLowerCase().includes(oppFilters.q));
  }

  if (!list.length) {
    box.innerHTML = `<div class="empty">
      <div class="e-ico">💼</div>
      <h4>${Opportunities.items.length ? "Nothing matches those filters" : "No opportunities yet"}</h4>
      <p>${Opportunities.items.length ? "Try a different search or include expired postings." : "Be the first to share a job, fellowship or resource with fellow alumni."}</p>
      <button type="button" class="btn btn-primary" id="empty-post-opp">＋ Post an opportunity</button>
    </div>`;
    $("empty-post-opp")?.addEventListener("click", () => openOppModal());
    return;
  }

  box.innerHTML = list.map((o) => {
    const meta = OPP_META[o.type] || OPP_META.Other;
    const mine = o.posterUid === state.user?.uid;
    const canManage = mine || state.isAdmin;
    const expired = isExpired(o);
    const link = safeUrl(o.link);
    const fileUrl = safeUrl(o.fileUrl) || (String(o.fileUrl || "").startsWith("data:") ? o.fileUrl : "");
    return `
    <article class="opp${expired ? " expired" : ""}">
      <span class="opp-accent" style="background:${meta.color}"></span>
      <div class="opp-top">
        <span class="opp-ico" style="background:${meta.color}1a" aria-hidden="true">${meta.icon}</span>
        <div class="opp-main">
          <span class="chip ${meta.chip}">${esc(meta.label || o.type || "Other")}</span>
          ${expired ? `<span class="chip chip-danger">Closed</span>` : ""}
          <h4 class="opp-title">${esc(o.title)}</h4>
          <p class="opp-org">${esc(o.org)}${o.location ? ` · ${esc(o.location)}` : ""}</p>
          ${o.description ? `<p class="opp-desc">${esc(o.description)}</p>` : ""}
          <div class="opp-tags">
            ${o.deadline ? `<span class="chip ${expired ? "chip-danger" : "chip-warn"}">⏳ ${expired ? "Closed" : "Closes"} ${esc(formatDate(Date.parse(`${o.deadline}T00:00:00`)))}</span>` : ""}
            ${fileUrl ? `<a class="chip chip-info" href="${esc(fileUrl)}" target="_blank" rel="noopener">📎 ${esc(o.fileName || "Attachment")}</a>` : ""}
          </div>
          <div class="opp-foot">
            <span class="of-by">
              ${avatarHtml({ name: o.posterName, email: o.posterEmail, headshotUrl: o.posterPhoto })}
              <span>${esc(o.posterName || o.posterEmail || "An alum")} · ${esc(timeAgo(o.createdAt))}</span>
            </span>
            <span class="opp-actions">
              ${canManage ? `<button type="button" class="btn btn-quiet btn-sm" data-edit-opp="${esc(o.id)}">Edit</button>` : ""}
              ${canManage ? `<button type="button" class="btn btn-danger btn-sm" data-del-opp="${esc(o.id)}">Delete</button>` : ""}
              ${link ? `<a class="btn btn-ghost btn-sm" href="${esc(link)}" target="_blank" rel="noopener">Apply <span class="arw">→</span></a>` : ""}
            </span>
          </div>
        </div>
      </div>
    </article>`;
  }).join("");
}

$("opportunities-list").addEventListener("click", async (e) => {
  const edit = e.target.closest("[data-edit-opp]");
  if (edit) {
    const o = Opportunities.items.find((x) => x.id === edit.dataset.editOpp);
    if (o) openOppModal(o);
    return;
  }
  const del = e.target.closest("[data-del-opp]");
  if (del) {
    const ok = await confirmDialog("This opportunity will be removed for everyone.", { title: "Delete opportunity?", confirmLabel: "Delete" });
    if (!ok) return;
    await Opportunities.remove(del.dataset.delOpp);
    toast("Opportunity deleted.", "info");
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   MILESTONES
   ══════════════════════════════════════════════════════════════════════ */
$("post-milestone-btn").addEventListener("click", () => openMsModal());
$("ms-file").addEventListener("change", (e) => {
  $("ms-file-name").textContent = e.target.files?.[0]?.name || "Upload an image";
});

function openMsModal(existing = null) {
  state.editingMs = existing;
  $("milestone-title").textContent = existing ? "Edit update" : "Post an update";
  $("ms-submit").textContent = existing ? "Save changes" : "Publish update";
  $("ms-id").value = existing?.id || "";
  $("ms-title").value = existing?.title || "";
  $("ms-content").value = existing?.content || "";
  $("ms-file").value = "";
  $("ms-file-name").textContent = "Upload an image";
  setMsImagePreview(existing?.imageUrl || "");
  openModal("milestone-modal");
}

/** Show (or clear) the existing cover image alongside the upload control. */
function setMsImagePreview(url) {
  $("ms-image-current").value = url || "";
  const wrap = $("ms-image-preview");
  const thumb = $("ms-image-thumb");
  const shown = url && (String(url).startsWith("data:") ? url : safeImg(url));
  wrap.hidden = !shown;
  if (shown) thumb.src = shown;
  else thumb.removeAttribute("src");
}

$("ms-image-remove").addEventListener("click", () => setMsImagePreview(""));

$("milestone-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("ms-submit");
  btn.disabled = true;
  const label = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span> Publishing…';
  try {
    const data = {
      title: $("ms-title").value.trim(),
      content: $("ms-content").value.trim(),
      // Keep whatever is already stored unless a new file is uploaded or the
      // author explicitly removed it. Legacy rows may hold an external URL.
      imageUrl: $("ms-image-current").value,
    };
    const file = $("ms-file").files?.[0];
    if (file) {
      if (file.size > 8 * 1024 * 1024) throw new Error("Images must be under 8 MB.");
      data.imageUrl = await uploadFile(`milestones/${Date.now()}_${file.name}`, file, { allowInline: true });
    }
    if (state.editingMs) {
      await Milestones.update(state.editingMs.id, data);
      toast("Update saved.", "ok");
    } else {
      await Milestones.add({
        ...data,
        authorUid: state.user.uid,
        authorName: state.profile.name || state.user.email,
      });
      toast("Your update is live.", "ok", "Published");
    }
    closeModal("milestone-modal");
    $("milestone-form").reset();
    state.editingMs = null;
  } catch (err) {
    toast(err.message || "Could not publish the update.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

function renderMilestones() {
  const box = $("milestones-list");
  if (!box) return;
  if (!Milestones.ready) {
    box.innerHTML = `<div class="skeleton" style="height:220px;border-radius:16px;"></div>`;
    return;
  }
  $("count-milestones").textContent = String(Milestones.items.length);

  if (!Milestones.items.length) {
    box.innerHTML = `<div class="empty">
      <div class="e-ico">📰</div>
      <h4>No updates yet</h4>
      <p>Conference recaps, alumni achievements and community news will appear here.</p>
      ${state.isAdmin ? '<button type="button" class="btn btn-primary" id="empty-post-ms">＋ Post the first update</button>' : ""}
    </div>`;
    $("empty-post-ms")?.addEventListener("click", () => openMsModal());
    return;
  }

  box.innerHTML = Milestones.items.map((m) => {
    const img = safeImg(m.imageUrl);
    return `
    <article class="milestone">
      ${img ? `<div class="ms-img"><img src="${esc(img)}" alt="" loading="lazy"></div>` : ""}
      <div class="ms-body">
        <div class="ms-meta">
          <span><span class="dot" aria-hidden="true"></span>${esc(formatDate(m.createdAt))}${m.authorName ? ` · ${esc(m.authorName)}` : ""}</span>
          ${state.isAdmin ? `<span style="display:flex;gap:4px;">
            <button type="button" class="btn btn-quiet btn-sm" data-edit-ms="${esc(m.id)}">Edit</button>
            <button type="button" class="btn btn-danger btn-sm" data-del-ms="${esc(m.id)}">Delete</button>
          </span>` : ""}
        </div>
        <h4>${esc(m.title)}</h4>
        <p class="ms-text">${esc(m.content)}</p>
      </div>
    </article>`;
  }).join("");
}

$("milestones-list").addEventListener("click", async (e) => {
  const edit = e.target.closest("[data-edit-ms]");
  if (edit) {
    const m = Milestones.items.find((x) => x.id === edit.dataset.editMs);
    if (m) openMsModal(m);
    return;
  }
  const del = e.target.closest("[data-del-ms]");
  if (del) {
    const ok = await confirmDialog("This update will be removed for everyone.", { title: "Delete update?", confirmLabel: "Delete" });
    if (!ok) return;
    await Milestones.remove(del.dataset.delMs);
    toast("Update deleted.", "info");
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   CONFERENCE: PHOTO LIBRARY + FEEDBACK FORM
   ══════════════════════════════════════════════════════════════════════ */
const photoFilters = { q: "", year: "" };

$("photo-search").addEventListener("input", debounce((e) => {
  photoFilters.q = e.target.value.trim().toLowerCase();
  renderPhotos();
}));
$("photo-filter-year").addEventListener("change", (e) => {
  photoFilters.year = e.target.value;
  renderPhotos();
});

/** Rebuild the year dropdown only when the set of years actually changes. */
function populatePhotoYears() {
  const sel = $("photo-filter-year");
  const years = [...new Set(published().map((p) => p.year).filter(Boolean))].sort((a, b) => b - a);
  const signature = years.join(",");
  if (sel.dataset.signature === signature) return;
  sel.dataset.signature = signature;
  const current = photoFilters.year;
  sel.innerHTML = `<option value="">All years</option>` +
    years.map((y) => `<option value="${esc(y)}">${esc(y)}</option>`).join("");
  if (years.includes(Number(current)) || current === "") sel.value = current;
  else { sel.value = ""; photoFilters.year = ""; }
}

/* Photos alumni upload wait on the team before they reach the library.
   Anything published before the review queue existed has no `status`, so
   "not pending" is what counts as published rather than status === "published". */
const isPending = (p) => p.status === "pending";
const published = () => Photos.items.filter((p) => !isPending(p));

function renderPhotos() {
  const box = $("photo-grid");
  if (!box) return;
  const live = published();
  $("count-photos").textContent = String(live.length);
  renderPhotoReview();

  if (!Photos.ready) {
    box.innerHTML = Array.from({ length: 6 }, () => `<div class="skeleton" style="aspect-ratio:4/3;border-radius:14px;"></div>`).join("");
    return;
  }
  populatePhotoYears();

  let list = [...live];
  if (photoFilters.year) list = list.filter((p) => String(p.year) === String(photoFilters.year));
  if (photoFilters.q) {
    list = list.filter((p) => [p.caption, p.city, p.year, p.uploaderName]
      .filter(Boolean).join(" ").toLowerCase().includes(photoFilters.q));
  }

  if (!list.length) {
    box.innerHTML = `<div class="empty" style="grid-column:1/-1;">
      <div class="e-ico">📷</div>
      <h4>${live.length ? "Nothing matches those filters" : "The library is empty"}</h4>
      <p>${live.length
        ? "Try a different search or clear the year filter."
        : "Photos published by the HPAIR team appear here. Use “Submit your photos” to send in your own."}</p>
    </div>`;
    return;
  }

  box.innerHTML = list.map((p) => {
    const src = safeImg(p.imageUrl);
    if (!src) return "";
    const cap = [p.city, p.year].filter(Boolean).join(" · ");
    return `<figure class="photo">
      <a href="${esc(src)}" target="_blank" rel="noopener" aria-label="Open full size photo">
        <img src="${esc(src)}" alt="${esc(p.caption || `HPAIR conference photo ${cap}`)}" loading="lazy">
      </a>
      ${state.isAdmin ? `<button type="button" class="photo-del btn btn-danger btn-sm" data-del-photo="${esc(p.id)}" aria-label="Remove photo">✕</button>` : ""}
      ${(p.caption || cap) ? `<figcaption>
        ${p.caption ? `<b>${esc(p.caption)}</b>` : ""}
        ${cap ? `<span>${esc(cap)}</span>` : ""}
      </figcaption>` : ""}
    </figure>`;
  }).join("");
}

$("photo-grid").addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del-photo]");
  if (!del) return;
  const ok = await confirmDialog("This photo will be removed from the library for everyone.", { title: "Remove photo?", confirmLabel: "Remove" });
  if (!ok) return;
  await Photos.remove(del.dataset.delPhoto);
  toast("Photo removed.", "info");
});

/* ---- Uploading photos: alumni submit, admins publish ---- */
$("add-photo-btn").addEventListener("click", () => openPhotoModal());
$("submit-photo-btn").addEventListener("click", () => openPhotoModal());
$("photo-files").addEventListener("change", (e) => {
  const files = [...(e.target.files || [])];
  $("photo-file-name").textContent = files.length
    ? `${files.length} image${files.length === 1 ? "" : "s"} selected`
    : "Choose one or more images";
});

function openPhotoModal() {
  $("photo-form").reset();
  $("photo-file-name").textContent = "Choose one or more images";
  $("photo-modal-title").textContent = state.isAdmin ? "Add photos to the library" : "Submit conference photos";
  $("photo-modal-sub").textContent = state.isAdmin
    ? "These go live in the library straight away."
    : "Upload the photos straight from your device. The HPAIR team reviews them before they appear in the library.";
  $("photo-submit").textContent = state.isAdmin ? "Add to library" : "Send for review";
  openModal("photo-modal");
}

$("photo-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("photo-submit");
  const label = btn.textContent;
  const files = [...($("photo-files").files || [])];
  if (!files.length) { toast("Choose at least one image.", "warn"); return; }

  const admin = state.isAdmin;
  btn.disabled = true;
  const shared = {
    caption: $("photo-caption").value.trim(),
    city: $("photo-city").value.trim(),
    year: Number($("photo-year").value) || null,
    uploaderUid: state.user.uid,
    uploaderName: state.profile.name || state.user.email,
    uploaderEmail: state.user.email,
    status: admin ? "published" : "pending",
  };

  let done = 0, failed = 0;
  try {
    for (const file of files) {
      btn.innerHTML = `<span class="spinner"></span> Uploading ${done + 1}/${files.length}…`;
      if (file.size > 8 * 1024 * 1024) { failed++; continue; }
      try {
        // Alumni write under their own uid; the curated library stays staff-only.
        const path = admin
          ? `library/${Date.now()}_${file.name}`
          : `photo_submissions/${state.user.uid}/${Date.now()}_${file.name}`;
        const imageUrl = await uploadFile(path, file, { allowInline: true });
        await Photos.add({ ...shared, imageUrl });
        done++;
      } catch (err) { console.warn("[photos] upload failed:", err); failed++; }
    }
    if (done) {
      toast(
        admin
          ? `${done} photo${done === 1 ? "" : "s"} added to the library.`
          : `${done} photo${done === 1 ? "" : "s"} sent to the HPAIR team. You'll see them in the library once they're approved.`,
        "ok", admin ? "Published" : "Thank you");
    }
    if (failed) toast(`${failed} file${failed === 1 ? "" : "s"} could not be uploaded. Images must be under 8 MB.`, "warn");
    if (done) { closeModal("photo-modal"); $("photo-form").reset(); }
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

/** Admin-only strip of alum submissions waiting to be published or declined. */
function renderPhotoReview() {
  const box = $("photo-review");
  if (!box) return;
  const queue = Photos.items.filter(isPending);
  box.hidden = !state.isAdmin || !queue.length;
  if (box.hidden) { box.innerHTML = ""; return; }

  box.innerHTML = `
    <div class="rq-head">
      <h3>${queue.length} photo${queue.length === 1 ? "" : "s"} waiting for review</h3>
      <p class="help">Submitted by alumni. Publishing adds a photo to the library below.</p>
    </div>
    <div class="rq-grid">${queue.map((p) => {
      const src = safeImg(p.imageUrl);
      if (!src) return "";
      const meta = [p.city, p.year].filter(Boolean).join(" · ");
      return `<figure class="rq-item">
        <img src="${esc(src)}" alt="${esc(p.caption || "Submitted conference photo")}" loading="lazy">
        <figcaption>
          ${p.caption ? `<b>${esc(p.caption)}</b>` : ""}
          ${meta ? `<span>${esc(meta)}</span>` : ""}
          <span class="rq-by">From ${esc(p.uploaderName || p.uploaderEmail || "an alum")}</span>
        </figcaption>
        <div class="rq-actions">
          <button type="button" class="btn btn-primary btn-sm" data-approve-photo="${esc(p.id)}">Publish</button>
          <button type="button" class="btn btn-danger btn-sm" data-reject-photo="${esc(p.id)}">Decline</button>
        </div>
      </figure>`;
    }).join("")}</div>`;
}

$("photo-review").addEventListener("click", async (e) => {
  const ok = e.target.closest("[data-approve-photo]");
  if (ok) {
    await Photos.update(ok.dataset.approvePhoto, { status: "published" });
    return toast("Photo published to the library.", "ok");
  }
  const no = e.target.closest("[data-reject-photo]");
  if (!no) return;
  const confirmed = await confirmDialog("This submission will be deleted and won't reach the library.",
    { title: "Decline photo?", confirmLabel: "Decline" });
  if (confirmed) { await Photos.remove(no.dataset.rejectPhoto); toast("Submission declined.", "info"); }
});

/* ---- Conference feedback form ---- */
function renderFormsConfig(cfg) {
  const c = cfg || FormsConfig.data || {};
  const box = $("feedback-embed");
  const embed = googleFormEmbedUrl(c.feedbackUrl);
  const plain = safeUrl(c.feedbackUrl);

  if (embed) {
    box.innerHTML = `<div class="form-embed"><iframe src="${esc(embed)}" title="Conference feedback form" loading="lazy">Loading the feedback form…</iframe></div>`;
  } else if (plain) {
    // A non-Google link is never framed, only offered as an outbound link.
    box.innerHTML = `<div class="empty">
      <div class="e-ico">📝</div>
      <h4>Feedback form</h4>
      <p>This link isn't a Google Form, so it opens in a new tab instead of being embedded.</p>
      <a class="btn btn-primary" href="${esc(plain)}" target="_blank" rel="noopener">Open the form</a>
    </div>`;
  } else {
    box.innerHTML = `<div class="empty">
      <div class="e-ico">📝</div>
      <h4>No feedback form yet</h4>
      <p>${state.isAdmin
        ? "Add a Google Form link under Form settings and it will appear here for everyone."
        : "The HPAIR team hasn't published a feedback form yet. Check back soon."}</p>
    </div>`;
  }
}

$("edit-forms-btn").addEventListener("click", () => {
  const c = FormsConfig.data || {};
  $("cfg-feedback-url").value = c.feedbackUrl || "";
  openModal("forms-modal");
});

$("forms-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("forms-submit");
  btn.disabled = true;
  try {
    await FormsConfig.write({ feedbackUrl: safeUrl($("cfg-feedback-url").value.trim()) });
    toast("Form link saved.", "ok");
    closeModal("forms-modal");
  } catch (err) {
    toast(err.message || "Could not save the links.", "error");
  } finally {
    btn.disabled = false;
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   AMBASSADOR APPLICATION
   ══════════════════════════════════════════════════════════════════════ */
async function loadMySubmission() {
  if (!state.user) return;
  try {
    const snap = await getDoc(doc(db, "ambassador_submissions", state.user.uid));
    state.mySubmission = snap.exists() ? snap.data() : null;
  } catch { state.mySubmission = null; }
  renderAmbassador();
}

$("amb-open-toggle").addEventListener("change", async (e) => {
  const cfg = AmbConfig.data || { open: true, questions: [] };
  await AmbConfig.write({ ...cfg, open: e.target.checked });
  toast(e.target.checked ? "Applications are now open." : "Applications are now closed.", "info");
});

$("add-question-btn").addEventListener("click", () => openModal("question-modal"));
$("q-type").addEventListener("change", (e) => {
  $("q-options-section").hidden = !(e.target.value === "select" || e.target.value === "checkbox");
});
$("question-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const type = $("q-type").value;
  const cfg = AmbConfig.data || { open: true, questions: [] };
  const questions = [...(cfg.questions || []), {
    id: `q${Date.now().toString(36)}`,
    label: $("q-label").value.trim(),
    type,
    required: $("q-required").checked,
    options: (type === "select" || type === "checkbox")
      ? $("q-options").value.split("\n").map((s) => s.trim()).filter(Boolean) : [],
  }];
  await AmbConfig.write({ ...cfg, questions });
  closeModal("question-modal");
  $("question-form").reset();
  $("q-options-section").hidden = true;
  toast("Question added.", "ok");
});

function renderAmbassador() {
  const box = $("ambassador-form-container");
  if (!box) return;
  const cfg = AmbConfig.data || { open: true, questions: [] };
  const questions = cfg.questions || [];
  $("amb-open-toggle").checked = cfg.open !== false;

  /* ---- Admin: question builder ---- */
  if (state.isAdmin) {
    box.innerHTML = questions.length
      ? `<p class="help" style="margin-bottom:12px;">${questions.length} question${questions.length === 1 ? "" : "s"} on the live application form${cfg.open === false ? ", which is currently closed to responses" : ""}. Use the arrows to reorder.</p>
         <div class="q-list">${questions.map((q, i) => `
           <div class="q-item">
             <span class="q-num">${i + 1}</span>
             <span class="q-info">
               <b>${esc(q.label)}${q.required ? ' <span style="color:var(--crimson)" title="Required">*</span>' : ""}</b>
               <span>${esc(QUESTION_TYPES[q.type] || q.type)}${q.required ? " · required" : ""}${q.options?.length ? ` · ${q.options.map(esc).join(", ")}` : ""}</span>
             </span>
             <span class="q-tools">
               <button type="button" class="btn btn-quiet btn-sm" data-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
               <button type="button" class="btn btn-quiet btn-sm" data-move="${i}" data-dir="1" ${i === questions.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
               <button type="button" class="btn btn-danger btn-sm" data-del-q="${i}">Remove</button>
             </span>
           </div>`).join("")}</div>`
      : `<div class="empty">
           <div class="e-ico">🏅</div>
           <h4>No questions yet</h4>
           <p>Add questions to build the ambassador application form. Alumni will see it as soon as you add the first one.</p>
         </div>`;
    return;
  }

  /* ---- Alum: already submitted ---- */
  if (state.mySubmission) {
    box.innerHTML = `<div class="empty" style="border-style:solid;border-color:#cfe9df;background:var(--ok-bg);">
      <div class="e-ico" style="background:#d5efe5;">✓</div>
      <h4>Your application is in</h4>
      <p>Submitted ${esc(formatDate(state.mySubmission.submittedAt))}. The alumni team will be in touch by email.</p>
    </div>`;
    return;
  }

  /* ---- Alum: not open / no questions ---- */
  if (!questions.length || cfg.open === false) {
    box.innerHTML = `<div class="empty">
      <div class="e-ico">🏅</div>
      <h4>Applications aren't open right now</h4>
      <p>The ambassador application isn't accepting responses at the moment. Watch the Milestones tab. We announce each round there.</p>
    </div>`;
    return;
  }

  /* ---- Alum: the form ---- */
  box.innerHTML = `
    <div class="amb-intro">
      <h4>Become an HPAIR Alumni Ambassador</h4>
      <p>Ambassadors represent HPAIR in their region, mentor incoming delegates, and help plan the next conference. It's a one-year volunteer role.</p>
      <div class="amb-steps">
        <div><b>1</b> Complete the form</div>
        <div><b>2</b> Short intro call</div>
        <div><b>3</b> Join the cohort</div>
      </div>
    </div>
    <form id="apply-form" class="apply-form">
      ${questions.map((q, i) => renderQuestion(q, i)).join("")}
      <div>
        <button type="submit" class="btn btn-primary btn-lg" id="apply-submit">Submit application <span class="arw">→</span></button>
        <p class="help" style="margin-top:10px;">You can only submit once, so take your time. Your name and email are attached automatically.</p>
      </div>
    </form>`;

  $("apply-form").addEventListener("submit", submitApplication);
}

function renderQuestion(q, i) {
  const name = `q_${i}`;
  const req = q.required ? "required" : "";
  const head = `<span class="label">${esc(q.label)} ${q.required ? '<span class="req">*</span>' : ""}</span>`;
  let body;
  switch (q.type) {
    case "long":
      body = `<textarea class="textarea" name="${name}" rows="5" ${req}></textarea>`; break;
    case "select":
      body = `<select class="select" name="${name}" ${req}><option value="">Choose one…</option>${(q.options || []).map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>`; break;
    case "checkbox":
      body = `<div class="check-grid">${(q.options || []).map((o) => `<label class="check"><input type="checkbox" name="${name}" value="${esc(o)}"> ${esc(o)}</label>`).join("")}</div>`; break;
    case "file":
      body = `<div class="filedrop"><span class="fd-ico" aria-hidden="true">📎</span><span class="fd-text"><b>Choose a file</b><span>PDF, image or video · up to 8 MB</span></span><input type="file" name="${name}" ${req}></div>`; break;
    default:
      body = `<input class="input" type="text" name="${name}" ${req}>`;
  }
  return `<div class="apply-q">${head}${body}</div>`;
}

async function submitApplication(e) {
  e.preventDefault();
  const form = e.target;
  const btn = $("apply-submit");
  const cfg = AmbConfig.data || { questions: [] };
  const questions = cfg.questions || [];

  btn.disabled = true;
  const label = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Submitting…';
  try {
    const answers = {};
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const name = `q_${i}`;
      if (q.type === "checkbox") {
        answers[name] = $$(`input[name="${name}"]:checked`, form).map((el) => el.value);
      } else if (q.type === "file") {
        const file = form.elements[name]?.files?.[0];
        if (file) {
          if (file.size > 8 * 1024 * 1024) throw new Error(`"${q.label}": files must be under 8 MB.`);
          answers[name] = await uploadFile(`ambassador/${state.user.uid}/${Date.now()}_${file.name}`, file, { allowInline: true });
        } else {
          answers[name] = "";
        }
      } else {
        answers[name] = form.elements[name]?.value?.trim() || "";
      }
      if (q.required && (!answers[name] || (Array.isArray(answers[name]) && !answers[name].length))) {
        throw new Error(`Please answer: "${q.label}"`);
      }
    }

    const payload = {
      uid: state.user.uid,
      email: state.user.email,
      name: state.profile.name || "",
      answers,
      questions: questions.map((q) => q.label),
      submittedAt: Date.now(),
      status: "new",
    };
    await Submissions.add(payload, state.user.uid);
    state.mySubmission = payload;
    renderAmbassador();
    toast("Application submitted. Good luck!", "ok", "Thank you");
  } catch (err) {
    toast(err.message || "Could not submit your application.", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = label;
  }
}

/* admin: reorder / remove questions */
$("ambassador-form-container").addEventListener("click", async (e) => {
  const cfg = AmbConfig.data || { open: true, questions: [] };
  const questions = [...(cfg.questions || [])];

  const move = e.target.closest("[data-move]");
  if (move) {
    const i = Number(move.dataset.move);
    const j = i + Number(move.dataset.dir);
    if (j < 0 || j >= questions.length) return;
    [questions[i], questions[j]] = [questions[j], questions[i]];
    await AmbConfig.write({ ...cfg, questions });
    return;
  }
  const del = e.target.closest("[data-del-q]");
  if (del) {
    const ok = await confirmDialog("Removing a question doesn't delete answers already submitted.", { title: "Remove question?", confirmLabel: "Remove" });
    if (!ok) return;
    questions.splice(Number(del.dataset.delQ), 1);
    await AmbConfig.write({ ...cfg, questions });
    toast("Question removed.", "info");
  }
});

/* admin: submissions viewer */
$("view-applications-btn").addEventListener("click", () => { renderSubmissions(); openModal("submissions-modal"); });

function renderSubmissions() {
  const box = $("submissions-list");
  if (!box || !state.isAdmin) return;
  const rows = Submissions.items;
  if (!rows.length) {
    box.innerHTML = `<div class="empty"><div class="e-ico">📥</div><h4>No submissions yet</h4><p>Applications appear here as alumni submit them.</p></div>`;
    return;
  }
  box.innerHTML = rows.map((s) => `
    <div class="submission">
      <div class="sb-head">
        ${avatarHtml({ name: s.name, email: s.email })}
        <b>${esc(s.name || s.email || "…")}</b>
        <span>${esc(s.email || "")}</span>
        <span class="chip chip-info" style="margin-left:auto;">${esc(formatDate(s.submittedAt || s.createdAt))}</span>
      </div>
      ${Object.entries(s.answers || {}).map(([key, val], i) => {
        const q = s.questions?.[i] || key;
        const isUrl = typeof val === "string" && /^https?:\/\//i.test(val);
        const shown = Array.isArray(val) ? val.join(", ") : String(val || "…");
        return `<div class="sb-a">
          <p class="sb-q">${esc(q)}</p>
          <p class="sb-v">${isUrl ? `<a href="${esc(val)}" target="_blank" rel="noopener" style="color:var(--crimson);font-weight:600;">Open attachment ↗</a>` : esc(shown)}</p>
        </div>`;
      }).join("")}
    </div>`).join("");
}

$("export-submissions").addEventListener("click", () => {
  const rows = Submissions.items;
  if (!rows.length) return toast("There's nothing to export yet.", "info");
  const headers = ["Name", "Email", "Submitted", ...(rows[0].questions || [])];
  const cell = (v) => `"${String(Array.isArray(v) ? v.join("; ") : (v ?? "")).replace(/"/g, '""')}"`;
  const csv = [
    headers.map(cell).join(","),
    ...rows.map((s) => [s.name, s.email, formatDate(s.submittedAt || s.createdAt),
      ...Object.values(s.answers || {})].map(cell).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `hpair-ambassador-submissions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${rows.length} submission${rows.length === 1 ? "" : "s"}.`, "ok");
});

/* ══════════════════════════════════════════════════════════════════════════
   COMMUNITY CHAT
   ══════════════════════════════════════════════════════════════════════ */
const feed = $("community-feed");

/** Escape first, then turn bare URLs into links (escaping the href separately
    so query strings survive the HTML-escaping pass). */
function linkify(text) {
  const out = [];
  const re = /https?:\/\/[^\s<>"']+/g;
  let last = 0, m;
  while ((m = re.exec(String(text ?? "")))) {
    out.push(esc(text.slice(last, m.index)));
    const url = m[0].replace(/[.,;:!?)]+$/, "");
    out.push(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`);
    last = m.index + url.length;
  }
  out.push(esc(String(text ?? "").slice(last)));
  return out.join("");
}

function renderMessages(rows) {
  if (!feed) return;
  const docs = [...(rows || [])].reverse();   // oldest → newest for display
  if (!Messages.ready) {
    feed.innerHTML = `<p class="help" style="text-align:center;padding:30px 0;">Loading messages…</p>`;
    return;
  }
  const chip = $("chat-status");
  if (chip && !net.degraded) { chip.textContent = "● Live"; chip.className = "chip chip-ok"; }

  if (!docs.length) {
    feed.innerHTML = `<div class="empty" style="margin:auto;">
      <div class="e-ico">💬</div><h4>No messages yet</h4>
      <p>Be the first to post something.</p></div>`;
    return;
  }

  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 90;
  const myUid = state.user?.uid;
  let lastDay = "";

  feed.innerHTML = docs.map((m) => {
    const day = formatDate(m.createdAt) || "Today";
    const sep = day !== lastDay ? `<div class="chat-daysep"><span>${esc(day)}</span></div>` : "";
    lastDay = day;

    const own = m.authorUid === myUid;
    const author = m.authorName || m.authorEmail || "Alum";
    const time = toMillis(m.createdAt)
      ? new Date(toMillis(m.createdAt)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "";
    const reactions = m.reactions || {};
    const countOf = (emoji) => Object.keys(reactions[emoji] || {}).length;
    const used = REACTIONS.filter(countOf);
    const unused = REACTIONS.filter((e) => !countOf(e));
    const bar =
      used.map((emoji) => {
        const on = Boolean(reactions[emoji]?.[myUid]);
        return `<button type="button" class="react-btn${on ? " on" : ""}" data-mid="${esc(m.id)}" data-emoji="${emoji}" aria-pressed="${on}">${emoji}<span>${countOf(emoji)}</span></button>`;
      }).join("") +
      `<span class="react-palette">${unused.map((emoji) =>
        `<button type="button" class="react-btn react-add" data-mid="${esc(m.id)}" data-emoji="${emoji}" title="React with ${emoji}">${emoji}</button>`).join("")}</span>`;

    return `${sep}
    <div class="msg${own ? " own" : ""}">
      ${avatarHtml({ name: author, email: m.authorEmail, headshotUrl: m.authorPhoto })}
      <div class="msg-col">
        <div class="msg-meta">
          <b>${esc(own ? "You" : author)}</b><span>${esc(time)}</span>
          ${(own || state.isAdmin) ? `<span class="msg-tools"><button type="button" class="btn btn-danger btn-sm" style="padding:2px 6px;" data-del-msg="${esc(m.id)}" aria-label="Delete message">✕</button></span>` : ""}
        </div>
        <div class="msg-bubble">${linkify(m.text || "")}</div>
        <div class="msg-react-row">${bar}</div>
      </div>
    </div>`;
  }).join("");

  if (atBottom) feed.scrollTop = feed.scrollHeight;
}

$("message-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("message-input");
  const text = input.value.trim();
  if (!text || !state.user) return;
  input.value = "";
  try {
    await Messages.add({
      text,
      authorUid: state.user.uid,
      authorEmail: state.user.email,
      authorName: state.profile.name || state.user.email.split("@")[0],
      authorPhoto: state.profile.headshotUrl || "",
      reactions: {},
    });
    feed.scrollTop = feed.scrollHeight;
  } catch (err) {
    input.value = text;
    toast("Message not sent. Try again.", "error");
  }
});

feed?.addEventListener("click", async (e) => {
  const react = e.target.closest("[data-emoji]");
  if (react) return toggleReaction(react.dataset.mid, react.dataset.emoji);
  const del = e.target.closest("[data-del-msg]");
  if (del) {
    const ok = await confirmDialog("This message will be removed for everyone.", { title: "Delete message?", confirmLabel: "Delete" });
    if (ok) { await Messages.remove(del.dataset.delMsg); }
  }
});

async function toggleReaction(mid, emoji) {
  if (!state.user) return;
  const uid = state.user.uid;
  const msg = Messages.items.find((m) => m.id === mid);
  if (!msg) return;
  const has = Boolean(msg.reactions?.[emoji]?.[uid]);

  if (Messages.mode === "remote" && !String(mid).startsWith("loc_")) {
    try {
      await updateDoc(doc(db, "community_messages", mid), {
        [`reactions.${emoji}.${uid}`]: has ? deleteField() : true,
      });
      return;
    } catch (err) { Messages.goLocal(err); }
  }
  const reactions = { ...(msg.reactions || {}) };
  const uids = { ...(reactions[emoji] || {}) };
  if (has) delete uids[uid]; else uids[uid] = true;
  reactions[emoji] = uids;
  await Messages.update(mid, { reactions });
}

/* ══════════════════════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════════════════ */
$("foot-year").textContent = String(new Date().getFullYear());
populateIndustryOptions();
renderDirectory();
loadAllowlist().catch((err) => console.warn(err.message));

// Deep links: #career, #community, …
window.addEventListener("hashchange", () => {
  if (state.user) showTab(location.hash.replace("#", ""));
});
