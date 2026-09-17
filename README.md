# Cinema Classics

A personal tracker for the "1001 Movies You Must See Before You Die" canon and
every competitive Academy Award winner in history (1929–2026), built as a
static site with Firebase for cross-device watched-status sync, and an
optional live "ask Claude" button for films that don't have a write-up yet.

## One-time setup

**1. Re-apply the Firestore security rules** (they changed to support
per-person lists and shared analysis). In the [Firebase console](https://console.firebase.google.com/)
for the `movies-1674c` project → Firestore Database → Rules, paste in the
contents of `firestore.rules` from this repo, then Publish.

**2. Create the Firestore database**, if you haven't already (Firestore
Database → Create database → Start in production mode, any region is fine).

**3. GitHub Pages** should already be live at
`https://rfmsant.github.io/movieList/`. If not: repo → Settings → Pages →
Source: "Deploy from a branch" → Branch `main`, folder `/ (root)`.

**4. Set up the "Ask Claude" analysis Worker** (optional, but this is what
powers the button that writes up a film's deep analysis on demand). This is a
separate small project ([`cinema-worker`](https://github.com/rfmsant/cinema-worker)):

  a. Get an Anthropic API key at [console.anthropic.com](https://console.anthropic.com)
     (Settings -> API Keys). This is billed separately from your Claude.ai
     subscription - usage-based, but each film write-up costs a fraction of a
     cent, so normal use stays well under a dollar.

  b. Follow the setup steps in the
     [cinema-worker README](https://github.com/rfmsant/cinema-worker) - a
     short manual Cloudflare dashboard setup (create a Worker, paste in its
     code, add two secrets).

  c. Copy the resulting URL (looks like
     `https://cinema-analysis.<your-subdomain>.workers.dev`) and paste it in
     as `WORKER_URL` at the top of `js/app.js`, then push that change.

## Sharing with friends

Each person gets their own watched-list, keyed by a name in the URL — no
account needed. Send them a link like:

`https://rfmsant.github.io/movieList/?maria`

(swap `maria` for their name — letters/numbers/dashes only). They'll see the
exact same film and Oscar database as you, mark their own films watched
independently, and it'll remember them on that link from then on. Leaving the
name off (just the plain URL) defaults to your own list (`rui`).

The AI-generated analysis (once the Worker is set up) is shared by everyone —
the first person to ask for a given film's write-up generates it once, and
it's cached in Firestore so nobody pays for or waits on that film again.

## How the data is organized

- `data/films.json` — every film: the ~1,160-title "1001 Movies" canon plus
  every Oscar-winning film not already in it (~2,250 total). Each entry has
  title/year/director/cast/runtime/genres/poster where known, plus fields for
  curated writing: `why_iconic` (non-spoiler, shown by default), `hidden_analysis`
  (spoilers, shown behind a tap-to-reveal), and `fun_facts`. Where these are
  empty, the site either shows a cached Firestore-generated write-up or the
  "Ask Claude" button.
- `data/oscars.json` — every ceremony (1st–98th) with every competitive
  category's winner, cross-linked to `films.json` where that film is tracked.

**Known gaps:** about 1,050 films that only won a smaller technical award
(sound editing, a short film, etc.) don't have verified director/poster/cast
yet. Country/language data isn't populated yet either (so the random-picker
only filters by genre and decade for now). Best Picture winners and the full
1001 list are complete on director/poster. These fill in gradually.

## Firebase note

The `apiKey` in `js/firebase-config.js` is not a secret (Firebase config is
meant to be public — see Google's own docs on this). The `firestore.rules`
file is what actually protects your data — it now allows any `/state/{name}`
document (so friends can each have one) and a shared `/analysis/{filmId}`
collection. There's still no login, so in principle anyone with the site URL
could write to any profile's watched-list or the analysis cache; for a
personal/friends tool that's an accepted tradeoff, not a bug. Add Firebase
Authentication later if you ever want to close that off.
