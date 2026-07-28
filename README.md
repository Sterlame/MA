# Ma (間)

A distraction-free personal writing tool. "Ma" is the Japanese concept
of purposeful empty space — the pause between notes that gives them
meaning. That's the design brief: a writing surface where the margin
is the feature, not a gap waiting to be filled with toolbars.

Static site, local-first storage, optional background sync to your
own Google Drive. No accounts system, no shared backend — everything
lives in your browser (IndexedDB) and, optionally, your Drive. That's
also how it works across devices: visit the same URL from your phone
and your laptop, sign into the same Google account, and both stay in
sync through your own Drive — no server Anthropic or anyone else
operates in between.

## Features

- **Local-first editing** — autosaves to IndexedDB every ~500ms, works fully offline
- **Live markdown** — headings, `> quotes`, `- lists`, `**bold**`, `*italic*`, `` `code` `` render as you type; storage is always plain text underneath
- **Notebooks** — organize documents into folders that mirror real Drive folders
- **Tabs/sections per document** — like Google Docs tabs; rename via the pencil icon or double-click
- **Style presets** — Normal / Title / Subtitle / Heading 1–3, applied to the current paragraph
- **Tag manager** — add/remove tags per document, filterable from search
- **Cross-notebook search** — searches every notebook at once, shows which notebook each hit is in
- **Command palette** — `Cmd/Ctrl+K` to jump straight to any document
- **Focus mode** — hides chrome and pins the writing column to the left (matches the header), with selectable dimming: off / current line / current paragraph
- **Typewriter scrolling** — keeps your current line vertically centered
- **Page lines, formatting marks, word-count-based pagination** — all in the Format/Tools menus
- **6 curated fonts** (including Comic Sans) + 4 sizes + 3 themes (light/sepia/dark)
- **Export** — current tab or the whole document as `.md`
- **Drive sync** — push local changes and pull anything new from Drive, so a second device picks up your existing docs; `.md` files with YAML frontmatter, so they're readable outside the app too
- **Versioning** — deliberately not reinvented; Drive's own file revision history covers "I need yesterday's version"

## Getting started

**Don't open `index.html` by double-clicking it.** Browsers restrict
IndexedDB under a bare `file://` URL, which breaks storage. Always
serve the folder over HTTP, even locally:

```bash
cd ma
python3 -m http.server 8000
# then open http://localhost:8000
```

1. **Try it locally first** — serve as above. Notebooks, tabs, focus mode, themes, export all work immediately; none of that needs Drive.
2. **Deploy the backend** — follow [`apps-script/README.md`](apps-script/README.md) to deploy the Apps Script Web App. You'll get a URL ending in `/exec`.
3. **Put the site online** — push this repo to GitHub, enable GitHub Pages (Settings → Pages → deploy from `main` / root). You'll get a `https://yourname.github.io/reponame` URL.
4. **Connect Drive** — click **connect drive** in the sidebar, paste the Apps Script URL when prompted, and approve the Google OAuth screen (see the note on the "unverified app" warning in `apps-script/README.md` — it's expected).

## Using it across devices

Once steps 2–4 above are done once (on any device), getting a second
device set up is just:

1. Open the same GitHub Pages URL on the new device (phone, laptop, whatever).
2. Click **connect drive**, paste the *same* Apps Script URL.
3. Sign into the *same* Google account and click through the one-time "unverified app" warning.

Ma will then pull down every notebook and document that already
exists in that Drive account. From then on, each device auto-syncs
in the background (every 45s) and also on-demand via **sync now**.

A couple of honest caveats worth knowing:

- **Sync is last-write-wins**, not merge. If you edit the same
  document on two devices while both are offline, whichever syncs
  last overwrites the other. Fine for how you'd actually use this
  (one device at a time), but don't expect Google-Docs-style
  real-time merging.
- **Mobile browser quirks** — `contenteditable` behaves slightly
  differently across mobile Safari/Chrome (autocapitalize, autocorrect
  popups, virtual keyboard covering the status bar). It works, but
  hasn't been tuned specifically for phone typing yet — flag anything
  that feels rough and we can adjust.
- The very first sync on a new device with a lot of existing documents
  will take a few seconds (each doc is fetched individually from Drive).

## Project structure

```
index.html           shell + layout
css/styles.css        design tokens, themes, focus mode, menus
js/db.js              IndexedDB wrapper (notebooks, documents, meta/settings)
js/markdown.js        live markdown rendering + markdown <-> DOM
js/sync.js            Drive push/pull via the Apps Script backend
js/app.js             app state, all UI wiring, autosave
apps-script/Code.gs   Drive backend, deployed as a Web App
```

## Design notes

- Type: Source Serif 4 for writing, IBM Plex Mono for UI chrome — the split reinforces "this is a tool" vs. "this is your prose."
- Editor column caps at 680px (620px in focus mode); focus mode pins the column to the header's left edge via an animatable `padding-left` rather than flex-centering, which is what makes the shift-left transition actually smooth.
- Inline formatting (bold/italic/code) only re-renders on lines the cursor has left, so it never fights your typing.
- Documents are stored as one file per document, tabs concatenated with `# Tab name` headers and `---` dividers (same shape as the in-app "export whole document" output) — so a synced file is just as readable outside the app.
- Not built: real-time collaboration, rich version-history UI, plugin system. Kept out on purpose — this is meant to stay small.

## Known limitations

- Conflict handling on sync is last-write-wins, as noted above.
- No offline queueing UI — if Drive is unreachable, sync silently retries on the next interval.
- Pulling from Drive matches documents by their Drive file ID, so a document synced from one device will correctly avoid re-downloading itself as a duplicate on that same device — but a document you *export* and manually re-upload elsewhere in Drive would come in as a new, separate document.
