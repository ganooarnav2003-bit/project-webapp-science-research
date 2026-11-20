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

## Public topic pages
`/topics` lists 100 study topics (10 subjects x 10). Each has its own public page at `/topics/<slug>`
showing an overview and any matching uploads. `/sitemap.xml` and `/robots.txt` are generated.
Set `PUBLIC_URL=https://your-domain` so the sitemap uses your real address.

## Plans and payments (INR, Razorpay)
| Plan | Monthly | Yearly | Uploads | Max file |
|------|---------|--------|---------|----------|
| Free | ₹0 | ₹0 | 5 | 5 MB |
| Student | ₹199 | ₹1,999 | 50 | 10 MB |
| Pro | ₹499 | ₹4,999 | unlimited | 25 MB |

Prices and limits live in `PLANS` at the top of `server.js`. Payments stay off until you set:
```bash
export RAZORPAY_KEY_ID=rzp_test_xxx        # start with Test Mode keys
export RAZORPAY_KEY_SECRET=xxx
export RAZORPAY_WEBHOOK_SECRET=xxx         # optional but recommended
npm start
```
In the Razorpay dashboard add a webhook to `https://your-domain/api/billing/webhook` for the
`payment.captured` and `order.paid` events. Amounts are always set by the server, and every payment
is activated only after its signature is verified.

## Flaskie chat assistant
A floating flask-robot button (bottom right of every page) opens a chat that:
- answers questions about the site (plans in ₹, uploading, subscribing, comments/queries),
- searches the 100 topics and all shared uploads and links to the best matches,
- optionally answers study questions with Claude (logged-in users only, 20 AI answers/hour each).

AI answers are off until you set a key; without it the bot still does the search and site help:
```bash
export ANTHROPIC_API_KEY=sk-ant-xxx
export CHAT_MODEL=claude-haiku-5-5   # optional, this is the default
```
When AI is on, the question text, recent chat turns and matching topic/upload titles are sent to Anthropic.
Usernames are not sent. Mention this in your privacy policy.

## Deploying
This is a Node server (not a static site), so it needs a host that runs `node`: Render, Railway, Fly.io,
a VPS, or Docker. GitHub Pages, plain Netlify/Vercel static hosting, and serverless functions will not work
(no long-running server, and files/uploads can't be saved).

| Setting | Value |
|---|---|
| Build command | none (or `npm install`; there are no dependencies) |
| Start command | `npm start` |
| Node version | 18 or newer (22 recommended) |
| Port | uses the `PORT` the host provides, listens on 0.0.0.0 |
| Health check path | `/healthz` |

Environment variables:
- `TRUST_PROXY=1` when behind a host's proxy/HTTPS, so rate limits are per visitor and cookies are `Secure`.
- `DATA_DIR=/path/on/persistent/disk` so accounts and uploads survive redeploys (container disks are wiped on every deploy otherwise).
- `PUBLIC_URL`, `RAZORPAY_*`, `ANTHROPIC_API_KEY`: see the sections above.

Docker: `docker build -t notebook . && docker run -p 3000:3000 -v notebook-data:/data notebook`

## Vercel
`vercel.json` + `api/index.js` run the whole app as one serverless function, so importing the repo on
Vercel works with no build step. **Limits of serverless:** data is saved in `/tmp`, which is temporary
and not shared between instances, so accounts, uploads and comments can disappear at any time, and
requests over 4.5 MB are rejected (large uploads fail). The public topic pages, dashboard, plans page,
and chat search work normally. For real use with accounts/uploads, use a Node host with a persistent
disk (see Deploying) or move storage to a hosted database/blob store.
