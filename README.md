# Alumni Portal

Single-page alumni portal with Firebase auth, online presence, and user registry.

## Features
- Register only with emails present in `alumni_portal.csv`.
- Log in/out via Firebase Authentication (email/password).
- Currently online users list (presence) pulled from Firestore.
- Registered users list (all accounts) pulled from Firestore.


Serve the app (needed so the CSV can be fetched), e.g.:
   ```bash
   cd /Users/natalia_mac/Desktop/alumni-portal
   python3 -m http.server 8000
   ```
   Then open http://localhost:8000 in the browser.

## Files
- `index.html` – UI with register/login, online users table, registered users table.
- `app.js` – Auth + allowlist enforcement + presence + user registry handling.
- `firebase-config.js` – Fill with your Firebase project config.
- `alumni_portal.csv` – Allowed emails (one per line).
- `styles.css` – Basic styling.



## General notes

this is incredibly bad and ugly, the corresponding firebase is in the alumni-portal project within tech-help@hpair.org firebase account