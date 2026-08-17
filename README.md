# HPAIR Delegate Alumni Portal

A two-page site for HPAIR delegate alumni:

- **`home.html`** — the public landing page (dark crimson + gold, spinning 3D globe of every Asia Conference host city, FAQ).
- **`index.html`** — the portal itself: sign-in, alumni directory, career hub, milestones, community chat and the ambassador application.

Everything is plain HTML/CSS/JS with Firebase (Auth + Firestore + Storage). There is no framework and no CSS build step.

---

## Running it

The site must be served over `http://` — opening `index.html` from the file system will break the alumni-allowlist fetch and the ES modules.

```bash
npm install
npm run dev          # Vite dev server, prints a local URL
```

To produce a deployable build:

```bash
npm run build        # → dist/ (both pages, bundled JS/CSS, everything in public/)
npm run preview      # serve dist/ exactly as it will be deployed
```

Use `npm run dev` rather than a bare static server on the repo root: files in
`public/` are served from `/` (that is what the build does too), so
`/img/earth.jpg` resolves in dev and in `dist/` but not if you point a plain
file server at the source folder.

### `public/`

Runtime files the bundler never sees, copied to the build root as-is:

| Path | What it is |
| --- | --- |
| `delegate_alumni_portal.csv` | the alumni allowlist, `fetch`ed at sign-up |
| `img/earth.jpg` | night-earth texture for both globes (2048×1024, 115 KB) |
| `img/hpair-mark.png` | the HPAIR logo, used in both navs and as the favicon |
| `img/aconf-delegates.jpg` | photo behind the landing page's closing call to action |
| `vendor/globe.gl.min.js` | globe.gl 2.34.4, which bundles three.js |
| `vendor/cropper.min.{js,css}` | Cropper.js 1.5.13, for the headshot cropper |

The two `vendor/` libraries and all three images used to be fetched from unpkg,
cdnjs and a Squarespace CDN. On a slow connection that put roughly 2.5 MB of
third-party requests in front of first paint and the landing page took over a
minute to finish loading; served from our own origin it is about two seconds.
When upgrading either library, replace the file and update the version in the
comment beside its `<script>` tag.

---

## Admin access

> **This changed.** The old hard-coded `hpair-tech` / `admin123` login is gone. That password was sitting in plain sight in `app.js`, and because it never signed in to Firebase, an "admin" could not actually write anything once real security rules were in place.

Admins are now normal Firebase accounts. You get admin rights if **either**:

1. your email is listed in `ADMIN_EMAILS` at the top of [`app.js`](app.js) — currently `tech-help@hpair.org` and `finance@hpair.org`; **or**
2. your document in the `users` collection has `role: "admin"`.

To set up the first admin, register `tech-help@hpair.org` through the normal Create Account flow (it is already on the allowlist). To promote someone else, set `role: "admin"` on their `users/{uid}` document in the Firebase console. The security rules stop people granting themselves that field.

Admins can post and edit milestones, build the ambassador application form, open/close applications, read and export submissions, and delete any chat message or opportunity.

---

## Firebase setup

The client config lives in [`firebase-config.js`](firebase-config.js) (the project is `delegate-alumni-hpair` under the `tech-help@hpair.org` account). `firebase.json` points the CLI at the two rules files below.

**Deploy the security rules** — this is what "fix permissions" in `nodes.txt` was about. Without them the new collections are unreadable, and the portal will drop into local-only mode (it shows a banner when this happens).

```bash
firebase deploy --only firestore:rules,storage
```

…or paste [`firestore.rules`](firestore.rules) and [`storage.rules`](storage.rules) into the Firebase console.

Also make sure **Authentication → Sign-in method → Email/Password** is enabled, otherwise registration and the password-reset email will fail.

### Collections

| Collection | What's in it | Who can write |
|---|---|---|
| `users/{uid}` | Profile: name, gradYear, headshotUrl, bio, title, company, location, linkedin, industries[] | Owner (not `role`), admins |
| `presence/{uid}` | `status` + `lastSeen` heartbeat, refreshed every 60s | Owner |
| `community_messages/{id}` | Chat text, author, `reactions` map | Author; anyone may toggle their own reaction |
| `opportunities/{id}` | Career Hub posts, incl. `deadline` and optional attachment | Poster, admins |
| `milestones/{id}` | Newsletter / recap posts | Admins |
| `config/ambassador` | `{ open: bool, questions: [...] }` | Admins |
| `ambassador_submissions/{uid}` | One submission per alum (doc id **is** the uid) | Applicant creates; admins read all |

> `role` on a user document is the **permission** field. A person's job title is stored separately as `title`, so nobody becomes an admin by typing "admin" into their job title.

### Local-only fallback

If Firestore is unreachable or blocked by rules, each collection independently falls back to `localStorage` and a warning bar appears at the top of the page. The portal keeps working, but changes stay in that one browser. Fixing the rules and reloading restores normal operation.

Similarly, if a Storage upload is rejected, small images fall back to being stored inline as data URLs so headshots and cover images still work. Note that admins promoted via `role: "admin"` (rather than being in the staff email list) will hit that fallback for milestone images, because Storage rules cannot read Firestore.

---

## The alumni allowlist

`public/delegate_alumni_portal.csv` is one email address per line. Only these addresses can create an account. It is fetched at runtime, so adding someone is just a matter of adding a line and redeploying — no rebuild required.

---

## Files

| File | Purpose |
|---|---|
| `home.html` | Public landing page + its scoped styles |
| `index.html` | Portal markup: auth screen, five tabs, all modals |
| `app.js` | Auth, allowlist, Firestore stores, and every feature's logic |
| `globe.js` | 3D globe, host-city timeline, scroll effects, mobile nav |
| `styles.css` | Shared design tokens + the whole portal component system |
| `firebase-config.js` | Firebase client config |
| `firestore.rules` / `storage.rules` | Security rules — deploy these |
| `vite.config.mjs` | Two-page build |
| `public/` | Runtime assets copied to the build root (see above) |
| `public/delegate_alumni_portal.csv` | Registration allowlist |

---

## Feature notes

- **Password reset** works from the sign-in screen (Firebase's email link). The confirmation message is deliberately identical whether or not the address exists.
- **Career Hub** posts support a closing date; expired posts are hidden behind the "Include expired" filter and shown grayed out. Posters can edit and delete their own.
- **Ambassador form** is admin-built: short/long answer, single choice, checkboxes and file upload. Questions can be reordered, applications can be closed, and submissions export to CSV.
- **Photo library** takes uploads from any alum: files go straight from their device to Storage as `status: "pending"` and appear in an admin-only review strip above the library, where the team publishes or declines each one. Admins uploading through "Add photos" publish immediately. Nothing on the site asks anyone for an image URL or an external link.
- **Presence** marks someone online for 5 minutes after their last heartbeat; the directory and community tab both show who is around.
- **Deep links**: `index.html#career`, `#milestones`, `#community`, `#ambassador` open straight to that tab.
