# Research Notebook

Personal experiment dashboard (customizable, ☰ toggle) plus a shared study-material library.

## Run
```bash
npm start        # http://localhost:3000  (PORT env var to change)
```
No dependencies; needs Node 18+. Data is stored in `data/` (db.json + uploads/), which is git-ignored.

## Features
- Accounts (register/login, scrypt-hashed passwords, HttpOnly session cookie)
- Upload study files (PDF, text, Word, PowerPoint, Excel, CSV, images; max 10 MB) with a "study material only" confirmation
- Subscribe to other users and view their uploads in "My subscriptions"
- Comment thread on every upload; mark a comment as a **query** (question) and the uploader can mark it answered
- Search the library by title, subject, description or uploader
