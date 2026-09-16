# Cinema Classics

A personal tracker for the "1001 Movies You Must See Before You Die" canon and
every competitive Academy Award winner in history (1929–2026), built as a
static site with Firebase for cross-device watched-status sync.

## One-time setup (do this once)

**1. Apply the Firestore security rules.** In the [Firebase console](https://console.firebase.google.com/)
for the `movies-1674c` project, go to Firestore Database → Rules, and paste
in the contents of `firestore.rules` from this repo, then Publish. This
restricts the database so only your one watched-list document is reachable —
without this step the database has no rules and is wide open.

**2. Create the Firestore database**, if you haven't already (Firestore
Database → Create database → Start in production mode, any region is fine).

**3. Enable GitHub Pages.** Repo → Settings → Pages → Source: "Deploy from a
branch" → Branch: `main`, folder `/ (root)`. Your site will be live at
`https://rfmsant.github.io/movieList/` within a minute or two.

That's it — open that URL on your phone, add it to your home screen (Share →
Add to Home Screen) for an app-like icon, and you're set.

## How the data is organized

- `data/films.json` — every film: the ~1,160-title "1001 Movies" canon plus
  every Oscar-winning film not already in it (~2,250 total). Each entry has
  title/year/director/cast/runtime/genres/poster where known, plus fields for
  curated writing: `why_iconic` (non-spoiler, shown by default), `hidden_analysis`
  (spoilers, shown behind a tap-to-reveal), and `fun_facts`.
- `data/oscars.json` — every ceremony (1st–98th) with every competitive
  category's winner, cross-linked to `films.json` where that film is tracked.

**Known gap:** about 1,050 films that only won a smaller technical award
(sound editing, a short film, etc.) don't have verified director/poster/cast
yet — those were left as "info pending" rather than guessed. Best Picture
winners and the full 1001 list are complete. This fills in gradually.

## Adding the curated write-ups

`why_iconic`, `hidden_analysis`, and `fun_facts` are empty for most films
right now (deliberately — writing genuine, accurate commentary for 2,250
films up front wasn't realistic to do well in one pass). The plan is to fill
these in progressively, starting with whatever you're about to watch next —
just ask in a future session and it'll get written directly into
`data/films.json`.

## Firebase note

The `apiKey` in `js/firebase-config.js` is not a secret (Firebase config is
meant to be public — see Google's own docs on this). The `firestore.rules`
file is what actually protects your data.
