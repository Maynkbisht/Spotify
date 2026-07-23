# Spotify Clone

A browser-based music player built with vanilla HTML, CSS, and JavaScript — no frameworks, no build step. Browse albums, play songs, and control playback just like the real thing.

## Features

- **Album browsing** — a grid of album cards pulled dynamically from a `songs/` directory, each showing its cover art, title, and artist.
- **Dynamic artist names** — the sidebar always shows the artist of the *currently selected* album, read live from that album's `info.json`.
- **Per-song cover art** — each song's own embedded ID3 cover art (read directly from the mp3 file) is shown in the sidebar, falling back to the album's `cover.png` if a track has no embedded art.
- **Play/pause sync** — the sidebar always shows exactly one song with a pause icon (the one actually playing); every other icon stays in sync automatically, no matter what triggered the change.
- **Auto-advance** — when a song finishes, the next track in the album plays automatically.
- **Playback controls** — play/pause, next, previous, seek bar with progress, volume slider, and mute.
- **Keyboard shortcuts**:
  | Key | Action |
  |-----|--------|
  | `Space` or `Tab` | Play / pause |
  | `M` | Mute / unmute |
- **Fast, responsive album switching** — album and song data load in parallel (not one-by-one), and switching albums quickly cancels any still-in-flight requests from the album you just left, so the UI never lags behind or shows stale data.

## Tech Stack

- HTML / CSS / vanilla JavaScript (no frameworks)
- [jsmediatags](https://github.com/aadsm/jsmediatags) — reads embedded ID3 cover art directly from mp3 files in the browser

## Project Structure

```
Spotify/
├── index.html
├── favicon.ico
├── css/
│   ├── style.css
│   └── utility.css
├── img/
│   ├── play.svg
│   ├── pause.svg
│   ├── volume.svg
│   ├── mute.svg
│   └── music.svg
├── script/
│   └── script.js
└── songs/
    ├── Cigarettes After Sex/
    │   ├── cover.png
    │   ├── info.json
    │   └── *.mp3
    ├── Commentary/
    │   ├── cover.png
    │   ├── info.json
    │   └── *.mp3
    └── ... (one folder per album)
```

## Running Locally

This is a static site — no build step or package install required for the app itself.

1. Make sure `jsmediatags` is included in `index.html` **before** `script.js`:
   ```html
   <script src="https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js"></script>
   <script src="script/script.js"></script>
   ```
2. Serve the project root with any local static server (must support serving directory listings, e.g. VS Code's **Live Server** extension), and open `index.html`.
3. It won't work by opening `index.html` directly from disk (`file://`) — the app relies on `fetch()` calls to list directory contents and load JSON/audio files, which requires an actual HTTP server.

## Adding a New Album

1. Create a new folder inside `songs/`, named after the album.
2. Add your `.mp3` files to it.
3. Add a `cover.png` — used as the album's card image and as the fallback icon for any song without embedded ID3 art.
4. Add an `info.json` with this shape:
   ```json
   {
     "title": "Album Title",
     "description": "A short description of the album.",
     "artist": "Artist Name"
   }
   ```
5. Refresh the page — the new album will automatically appear in the grid.

## Known Limitations

- Per-song cover art requires fetching each mp3 file in full to read its ID3 tags, so very large albums (50+ tracks) may show icons popping in gradually rather than all at once.
- Directory listings must be enabled on whatever local server you use — this won't work against a server that returns a 403/404 for folder requests instead of an index page.

## Credits

Album art, mp3s, and metadata are for personal/educational use only — this project is a UI/UX clone and does not host or distribute copyrighted audio.