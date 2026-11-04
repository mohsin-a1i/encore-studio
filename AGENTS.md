# Encore Studio

## Project structure

- `dist/` contains the frontend and backend, organized by feature. Keep related code together; do not add a separate `lib/` folder.
- `dist/app/`: application shell, browser state, shared controls, and global CSS.
- `dist/studio/`: song editor, collection, reference controls, and Auto complete modal.
- `dist/library/`, `dist/playback/`, `dist/profiles/`, `dist/settings/`: their respective pages and controls.
- `dist/songs/`: shared song model, storage, and generation orchestration.
- `dist/generation/`: Codex integration, reference preparation, ComfyUI API integration, and clean workflows. The single completion prompt and dynamic response schema live in `dist/generation/lyrics/`.
- `dist/server/`: Node HTTP service and routes. `dist/tests/` contains tests; `dist/tools/` contains maintenance utilities.
- `data/library.json` stores profiles and playlists. Each song owns its entity and files under `data/songs/<id>/`, including `song.json`, audio, cover, reference audio, ABC notation, and operation diagnostics. Preserve existing user data.
- `.sites-runtime/` holds local tools and private runtime files. Never expose cookies or credentials.

## Start and restart services

Run Encore scripts from the project root:

- Start: `.\start-studio.ps1` (port **4318**).
- Restart after backend changes: `.\restart-studio.ps1`.
- Frontend-only changes do not require a restart. Do not package or publish the site after changes.
- Before restarting, check for active lyric/audio generation or reference preparation. Do not interrupt active user work.

ComfyUI lives at `C:\Projects\ComfyUI`:

- Start: `& 'C:\Projects\ComfyUI\start.ps1'` (port **8188**). It initializes Visual Studio variables, activates `.venv\Scripts\Activate.ps1`, starts ComfyUI, and waits for readiness.
- Stop: `& 'C:\Projects\ComfyUI\stop.ps1'`. It identifies the ComfyUI server on port 8188 without a process-tracking file.
- Restart: run `stop.ps1`, then `start.ps1`; there is no separate ComfyUI restart script. Check for active work first.
- Codex starts `comfy-mcp.exe` separately through its MCP configuration; the ComfyUI launcher does not start MCP.

## Styling and verification

- Use the shared color and typography variables in `dist/app/base.css`. Do not introduce one-off colors, font families, sizes, or weights. Normalize unusual typography to the existing variable set.
- Use `heading-stack` and `--heading-subtext-gap` for heading and supporting-text pairs where the layout allows; keep semantic headings and appropriate inline markup inside buttons.
- Keep shared component styles consistent across devices. Use responsive differences for layouts or presentations that actually change, such as bottom navigation and the compact player.
- Editable text fields use `--font-size-body`: 14px on desktop and at least 16px on tablet and mobile to avoid focus zoom. The song title uses `--font-size-heading`. Preserve manual browser zoom.
- Check wrapping, spacing, and equal sizing of related buttons; genre tags must wrap without overlap.
- Run `npm run check` and relevant tests (`npm test` for the full suite). Format changed files with Prettier.

### Typography scale

Use DM Sans throughout, with a sans-serif fallback. Sizes below assume default browser settings; the rem-based values scale with the browser's font size.

| Variable              | Default size                             | Typical uses                                                                                                               |
| --------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--font-size-micro`   | 12px                                     | Eyebrows, filters, genre tags, playlist descriptions, navbar and New song subtitles, editor subtitles, and generation note |
| `--font-size-small`   | 12px (alias of micro)                    | Song status in Studio and connection status                                                                                |
| `--font-size-body`    | 14px desktop; 16px minimum tablet/mobile | Buttons, navigation, subheadings, text inputs, and editor titles and descriptions                                          |
| `--font-size-section` | 22px                                     | Settings and other section headings, and the mobile wordmark                                                               |
| `--font-size-heading` | 27px                                     | Page titles, dialog headings, and the song title field                                                                     |

## State ownership

- Profile-owned content lives on the studio: song drafts and files, playlists, favorites, profile preferences, and Explore sessions. Profile preferences and Explore coordinator state are stored in each profile's `workspace` in `data/library.json`.
- `dist/profiles/profile-workspace.mjs` owns the preference schema; `profile-preferences.js` handles browser commands. `dist/explore/explore-service.mjs` is the only owner of Explore generation reservations, buffer filling, decisions, and retirement. Reading or subscribing to Explore must never submit generation.
- `dist/app/device-state.js` is the only browser storage adapter. Limit it to device preferences, last-opened songs, playback resume, and unacknowledged text recovery. Do not store Explore sessions or import legacy browser state. Cookies and session storage are unnecessary.
- Use resource revisions for content edits, per-field bases for preferences, and session/card identifiers for Explore decisions. Retried commands must not duplicate generation or advance another card. Deleted request IDs must not recreate songs.
- `dist/playback/playback-leases.mjs` temporarily protects retired Explore audio being used by another device. Explicit deletion still removes the song logically, stops connected playback, and uses the existing durable file-cleanup queue.
- Draft recovery is a local copy until the server acknowledges a save. Never apply it silently over newer profile data. A deleted song can be recovered only through an explicit action that creates a new song.
