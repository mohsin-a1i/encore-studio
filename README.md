# Encore Studio

The project lives in `sites/encore-studio`. Existing songs and playlists are preserved. Browser preferences migrate to Encore storage keys, and older media filenames and environment overrides remain compatible. Open the interface directly from the running Studio service.

A personal music studio built around one song entity, from the first idea to the finished audio. The browser calls a local Node service. The service uses the signed-in Codex CLI only to write song text. It generates audio through the local ComfyUI HTTP API using the saved `yue2-song-from-style-and-lyrics` or `yue2-song-from-reference-abc` workflow.

## Profiles

Click a profile to switch to it. Use its edit icon to rename it in a separate dialog, or New profile to open the creation dialog.

Use the profile button at the top right to switch profiles, create a fresh collection, rename a profile, or delete it. Existing songs and playlists belong to **Guest**. Each profile has its own studio collection, playable library, playlists, and favorites. Switching stops playback and clears unsaved editor changes; background generation stays with its owning profile. The chosen profile is remembered on the device.

Deleting a profile stops its active and queued work and removes all its song folders, playlist artwork, and related ComfyUI files. If the last profile is deleted, Encore creates a fresh, empty Guest profile. Profiles organize a shared studio; they are not password-protected accounts.

Shared song links use `https://encore.eu1.netbird.services/?profile=PROFILE_ID#song/SONG_ID`, selecting the owning profile before opening song details and attempting playback. Ownership is stored as `profileId` in song and playlist records; profile names and IDs are stored in `data/library.json`. Existing media stays in its current song folder.

## Start

Run `npm ci` when setting up the project or after its package lock changes. The runtime uses Sharp to prepare PNG covers for OS media controls.

Run `start-studio.ps1`, then open **http://127.0.0.1:4318**. Use `restart-studio.ps1` after server changes. On a device connected to this computer in NetBird, open **http://desktop-77e69rc.netbird.cloud:4318**. Encore detects NetBird's `wt` tunnel address and listens on its IPv4 and IPv6 addresses as well as local loopback.

The private hosted interface connects to this same local service. Allow browser access to local devices if requested. Songs and playlists live on the studio computer, so it must be running and reachable.

Runtime prerequisites: Node 22+, the signed-in Codex CLI, ffmpeg, and ffprobe. Keep ComfyUI running at `http://127.0.0.1:8188`. Encore keeps its own clean API workflows in `dist/generation/workflows/`: `yue2-song-from-style-and-lyrics.json`, `yue2-song-from-reference-abc.json`, and `sheetsage2-reference-audio-to-abc.json`. The service uses these files directly and never searches ComfyUI for a workflow.

For YouTube and Instagram samples, run `dist/tools/install-audio-downloader.ps1`. It downloads and verifies the requested **2026.10.26** Windows release into `.sites-runtime/bin/yt-dlp.exe`. For YouTube, Encore reads the Netscape-format cookie file `.sites-runtime/bin/youtube-cookies.txt`; set `YTDLP_YOUTUBE_COOKIES` before starting Studio to use another path. Keep that file private. Instagram uses cookies from Microsoft Edge by default; set `YTDLP_COOKIES_BROWSER` to use another browser or yt-dlp browser profile specification. If the browser locks its cookie database, close it completely before loading a reference. Samples use the sibling `yue2-song-from-reference-abc.json` workflow. The downloader uses the existing Node.js runtime and ffmpeg; no npm dependency is needed.

Optional environment variables: `PORT` (4318), `CODEX_BIN`, `MUSIC_WORKFLOW`, `COMFY_OUTPUT_DIR`, `FFMPEG_BIN`, `FFPROBE_BIN`, `ENCORE_DATA_DIR`, and `ENCORE_DIST_DIR`.

Sample configuration: `MUSIC_COVER_WORKFLOW`, `MUSIC_REFERENCE_WORKFLOW`, `YTDLP_BIN`, and `COMFY_INPUT_DIR` override the score-based song workflow, audio-to-ABC workflow, downloader executable, and ComfyUI input folder.

## The song flow

### Explore

The visible deck has at most three cards total, including the loading card. Ready songs take priority over loading. Cards share one fixed frame, and promotions use short position transitions. Swipes advance the visible song and playback optimistically while session/card decisions save in order; failed writes reconcile with the server before restoring the deck. Reads and reconnects never generate songs.

Open **Explore**, tap the floating spark button, enter an idea in the dialog, and choose **Explore this idea**. Submitting a different idea clears the old deck and starts a fresh batch; submitting the same idea keeps the current deck. Encore generates a buffer of songs and begins playback when the first is ready; browsers that block automatic playback offer **Play song**. Swipe right to save the song to your library, or left to discard it and hear the next ready song. Buttons and the focused card's left/right arrow keys offer the same actions. Each decision refills the buffer. When all ready songs have been swiped, the generation card remains until the next song is ready.

Explore remembers each profile's idea, selected song, queue, and deferred deletions across refreshes. Existing song records also recover queues created before this persistence was added. Refreshing, switching profiles, or submitting the same idea preserves the candidates. An explicit swipe consumes a candidate; a song that finishes without a swipe or is skipped using player or headset controls is treated as a left swipe, with the same animation when Explore is visible. Changing the idea replaces the batch. The previous song keeps playing while the new deck generates, and its deletion stays queued until playback switches or the song ends. Playback switches directly to the next ready song; without a ready replacement it releases the source while generation continues. Temporary songs stay out of Studio, Library, Favorites, and playlists until saved; saving retains the original song ID and files. Generation failures refresh the shared service status. Explicit retry replaces failed candidates while retaining playable songs.

`POST /api/explore` accepts `idea` and `sessionId`; `POST /api/explore/:id/save` saves a finished candidate; `DELETE /api/explore/:id` discards only temporary songs. These endpoints use the active profile. The library response includes temporary entities separately as `exploreSongs`.

### Studio

1. The editor always offers **Reference Audio**, **Music Style**, and **Lyrics**. All sections start expanded and remain collapsible. On wide screens, reference audio and musical style sit side by side, with lyrics spanning the row below. There is no progress tracker or saved Original Idea section.
2. **Auto complete** opens an idea modal. The idea is optional when you already have song material. Encore uses the saved idea, title, lyrics, style, genre tags, and prepared reference to fill only missing fields. Existing fields are preserved. Clear a field in the editor if you want Auto complete to replace it. The submitted idea is saved on the song and shown when the modal opens again.
3. **Generate Song** requires only lyrics. Encore completes any missing title, musical style, and genre tags before submitting ComfyUI. Edits save automatically to existing songs; new-song fields stay in the browser draft until an entity is created. Load or remove a selected reference before generating. Previous audio remains available until a completed replacement is saved. Failed or cancelled requests preserve the available audio.
4. The writing and composing animations remain visible during generation, with the source material below them and **Stop Completing** or **Stop Composing**. Auto complete shows the saved idea and existing source material. The collection groups songs into **Draft**, **Auto completing**, **Composing Song**, and **Ready to play**. Draft includes every song without playable audio, whether its text is complete or still being edited; there is no Waiting for Idea state. Errors remain separate and no generation is retried automatically.
5. Titles save when their field loses focus. Change artwork on the cover. **Make a copy** duplicates the saved song and media with an available numbered title; editing or deleting a copy does not affect its source.
   The **studio shows every saved song entity**, including drafts, songs awaiting review, active generations, failures, and finished songs. Temporary Explore candidates appear there after they are saved. The **library shows saved entities with playable audio**. Favorites, playlists, search, and playback all refer to those same song IDs. Library, Favorites, and Studio use consistent search fields and wrapping filters.

In Overview, Library, Favorites, and playlist song lists, tapping the cover, title, or row starts playback. The three-dot button opens song details, and the explicit play/pause button still toggles playback. A list starts a queue in its displayed order. The player connects to the browser's Media Session API for headphone/media-key play, pause, next, previous, and seeking, with current title, cover, and playback position. Both previous buttons move to the previous song; next/previous restart playback when the queue has only one song. Native controls depend on browser and device support.

Playback commands run independently of card animations and background UI rendering. Returning to the page restores native handlers, metadata, and the visible player without restarting paused playback. Explore skips can proceed when the live-update stream disconnects, using the existing session/card decision command.

OS media artwork is served as PNG at 96, 128, 192, 256, 384, and 512 pixels, including for generated SVG covers. Image URLs retain the current cover version. Derived files are cached inside each song's `media-artwork/` folder, refreshed when the source cover changes, and removed with the song. Playback metadata and the audio element title update when the selected song, title, or cover changes.

The studio song shelf starts with New song and scrolls vertically when needed. A visible scrollbar and keyboard support make the rest of the list accessible, and the shelf preserves its position during updates. Selection uses a subtle background and outline; focus and system contrast preferences are respected.

Add optional **reference audio** in the Reference Audio section. A single-choice switch shows either **YouTube / Instagram video link** or **Audio file**, with the inactive input disabled. Switching inputs preserves the current reference and its preview; choosing a replacement or removing the reference saves that change without removing the song's audio. Uploads can be up to 25 MB. The backend rejects requests containing both sources. For a link, the connected **Load** button saves a new draft if needed, downloads the audio, and asks ComfyUI to extract notation. Choosing an audio file starts this process automatically. The Load button shows a spinner while the reference is being prepared. Progress and errors stay in the Reference Audio section. Downloaded and uploaded references share one `sampleFile` inside the song folder. Other song views show the recording name once known. If the reference has not loaded, generation opens and scrolls to Reference Audio with a message to load or delete it.

When reference notation is needed for lyrics or audio, Encore runs `sheetsage2-reference-audio-to-abc` through ComfyUI's API. Its four nodes are Load Audio → Audio Encoder Loader → SheetSage2 Audio to ABC → Save Text. It uses the installed `minimax-music3\sheetsage2_bf16.safetensors` encoder and full mode for melody and chords. This is the only workflow that receives the reference audio file. The result is saved as `referenceABC` on the song entity, with `referenceABCSource` identifying the sample it belongs to. The musical score captures melody, harmony, meter, tempo, and key; it is not a transcription of the sung words.

Before calling Codex, Encore converts the ABC into a small timing guide: tempo, ordered sections, and broad singing windows in approximate seconds. Barlines and short rests stay inside a window; longer gaps are space for instruments, sounds, and effects. The guide has no note patterns, syllable quotas, chorus matching, or vocal arrangement rules. Unsupported notation stops writing with an explanation.

One song-completion prompt sends the idea, existing song material, and optional reference guide to Codex. It asks for natural, singable sentences, complete thoughts or clauses before long pauses, and room between vocal lines for music and effects. The idea determines the form. The dynamic response schema requests only missing fields and genre tags that need refreshing. Metadata and section tags stay English; lyrics in other requested languages use Latin transliteration.

The successful guide is stored as referenceLyricsGuide with a version and score hash. The idea is saved on the song; the prompt stays in memory, and reference-guide.json is saved when a reference is used. Failed or cancelled writing retains the saved text, guide, and audio. Successful writing saves the new text and guide while keeping the current audio. Copies retain the guide; replacing or removing a reference clears it. The next successful generation removes any legacy referenceLyricPlan. Neither notation nor analysis appears in the interface. The guide estimates score timing; it does not force word-to-note alignment. See [lyric-generation flow](dist/generation/lyrics/README.md).

**Generate Song** first uses Codex to fill a missing title or musical style and refresh genre tags when needed. It then sends the confirmed style and lyrics to `yue2-song-from-style-and-lyrics` when there is no reference. With a reference, it uses `yue2-song-from-reference-abc` in melody mode. A derived copy of `referenceABC` removes chord symbols while retaining both vocal and instrumental melodies, all note onsets and lengths, ties, meter, key, tempo, and sections. Encore compares the parsed scores before submitting. The original transcription remains unchanged on the entity. This lets new style requests change harmony, instrumentation, and production without intentionally rewriting the tune. The workflow has no Load Audio, SheetSage2, or audio encoder nodes. If an older song has a reference but no score, use **Load**. Song generation does not download, upload, or reread the reference audio.

Reference failures stop the task with their details; no transcription, Codex task, or render is automatically retried or replaced. Temporary ComfyUI audio copies and ABC text outputs are removed after successful transcription. The original sample and notation remain inside the song entity, and deleting the song removes them with its other data.

For editable ComfyUI layouts of these same workflows, run `node dist/generation/export-workflows.mjs`. It reads Encore's API graphs and the installed node definitions only, then exports neatly arranged copies into `C:\Projects\ComfyUI\ComfyUI\user\default\workflows\encore`. An optional directory argument changes the export destination. The API versions in `dist/generation/workflows/` remain the service's source of truth.

## Storage

```text
data/
  library.json                 Profiles, playlists, and durable deletion tracking
  songs/
    <song-id>/
      song.json                The complete song entity
      cover.svg                Generated artwork, or an uploaded cover file
      audio-<run-id>.mp3        Current playable audio
      master-<run-id>.<ext>     Current master audio
      EncoreSample_*.mp3     This song's downloaded reference sample, when used
      work/
        <run-id>/              A text or audio operation owned by this song
          workflow.json        Expanded ComfyUI API graph for an audio operation
          submission.json      ComfyUI submission response or error
          result.json          Structured Codex result for a text operation
          codex-diagnostic.log
          sample-download.log  yt-dlp diagnostics for a sample download
  playlists/
    <playlist-id>/             Playlist cover art
```

`song.json` holds `status`, `title`, `idea`, `style`, `lyrics`, `genres`, `genreStyle`, favorites, timestamps, media filenames, and the current nested `job`. The job contains its operation kind, request ID, immutable input snapshot, timestamps, ComfyUI prompt ID and selected workflow. Files are relative to the owning song folder. Earlier workflow and diagnostic files stay under that folder for troubleshooting and are removed with the song. Text and reference edits preserve the current audio. A successful render saves the new media pointers before deleting superseded files; a failed or cancelled render only cleans up incomplete files. Temporarily locked cleanup targets remain tracked on the song.

ComfyUI initially writes to its own output directory. After the service imports and encodes the finished audio, it removes that operation's temporary ComfyUI output. Owned render IDs are retained for deletion cleanup after interrupted operations.

Song records are atomically written to their own folders. The library does not store a second song catalog. Startup reads the song folders and marks interrupted work as failed, preserving text, job information, and finished media. A retry stops any still-running render for that song before submitting another.

`data/` is private, ignored by Git, and excluded from hosted archives. Back up the whole directory to preserve your studio. Browser-local storage holds volume; session storage remembers the selected song.

## Status and API

The navigation's **Settings** button and the offline note open the settings page at `#settings`. It shows the overall connection state and dedicated **Studio**, **Codex**, and **ComfyUI** cards, with a purpose, status, troubleshooting guidance, and an independent verification/retry button for each. Studio retries load the library directly. Codex and ComfyUI retries force a fresh check of that dependency, independently of the normal 20-second status cache. Checks update the page in place and do not restart services. The offline note appears whenever any of the three is not connected, and connection, reconnection, and explicit retry events refresh those statuses. Other app actions report their own errors without opening settings.

**Appearance** offers six dark palettes: **Gilded Hour** (gold, the default), **Crimson Stage** (red), **Blue Nocturne** (blue), **Copper Glow** (orange), **Velvet Nebula** (purple), and **Silver Silence** (grey), followed by **Magic**. All backgrounds stay dark. Silver Silence removes color from interface tones while preserving cover art and semantic warning colors. Magic selects the nearest colored preset for a cover, or Silver Silence for a monochrome cover. With no current cover or unreadable artwork, it falls back to Gilded Hour. The favicon and browser color follow the applied palette. Saved choices from the retired palette set fall back to gold; selections from the new set are remembered.

Studio connects with one `GET /api/library` request, then subscribes to `GET /api/events` for profile-scoped snapshots pushed after durable saves. The browser has no periodic refresh loop. Native EventSource reconnection restores the latest snapshot after a disconnect. `GET /api/health/studio` verifies the service without waiting for Codex or ComfyUI. `GET /api/health` reads the cached dependency checks; `GET /api/health/codex` and `GET /api/health/comfy` explicitly recheck the selected dependency. API, playback, artwork, and download URLs work directly without session tokens.

Song statuses exactly match the studio filters. There is no additional Ready to Compose status.

| Status   | Filter          | Meaning                                                           |
| -------- | --------------- | ----------------------------------------------------------------- |
| `draft`  | Draft           | No playable audio; style and lyrics may be complete or incomplete |
| `lyrics` | Auto completing | A lyric request is queued or being processed                      |
| `audio`  | Composing Song  | An audio request is queued or being processed                     |
| `ready`  | Ready to play   | Playable audio is available                                       |

`job.phase` tracks the current task detail (queueing, downloading, preparation, writing, rendering, or saving). It is not a song status. Finished jobs use `job.outcome` for complete, failed, or cancelled work; errors stay on the song. After writing, failure, cancellation, or interrupted restart, songs return to Draft or Ready to play according to whether playable audio remains, even when it differs from the current text. Existing records migrate to these four statuses at startup.
`GET /api/library` returns the shared song and playlist records. Song operations are:

| Endpoint                     | Operation                                             |
| ---------------------------- | ----------------------------------------------------- |
| `POST /api/songs`            | Create a song and queue lyrics or audio               |
| `GET /api/songs/:id`         | Read the song                                         |
| `PATCH /api/songs/:id`       | Update favorite state                                 |
| `POST /api/songs/:id/lyrics` | Save edits and generate new song text                 |
| `POST /api/songs/:id/audio`  | Save edits and generate audio                         |
| `POST /api/songs/:id/copy`   | Create an independent copy                            |
| `POST /api/songs/:id/cancel` | Stop the current operation                            |
| `DELETE /api/songs/:id`      | Delete the entire entity, with its ID as confirmation |

Submit operations accept an `X-Request-Id` for duplicate-request protection. Text and audio work share one local queue. Generation fields remain freeform. ID/path, upload, playlist, and deletion checks protect storage.

## Implementation

```text
dist/
  index.html             Browser entry page
  app/                   Browser startup, state, connection client, shared controls and styles
  studio/                Studio page, editor view, editor actions, reference controls and Auto complete modal
  songs/                 Song entity, lifecycle service, routes, statuses and file cleanup
  generation/            Codex lyric writing, reference audio, ABC notation and ComfyUI rendering
    lyrics/              ABC parser, simple reference timing guide, Codex prompts, dynamic response schemas and CLI runner
    workflows/           Clean, project-owned ComfyUI API graphs
  library/               Library pages and dialogs, playlist routes, durable storage and cover art
  playback/              Audio playback controls, player view and styles
  settings/              Connection status, appearance settings and cover-based color themes
  server/                Service entry, configuration, dependency checks and request security
  tools/                 Source checks, live-service checks and downloader installation
  tests/                 Song lifecycle, routes, generation, storage and browser view tests
start-studio.ps1          Start the local service
restart-studio.ps1        Restart only this project's service
```

Application source, workflows, tools and tests live under `dist/`; there is no separate `lib/` folder or build step. Browser modules use `.js`, server modules use `.mjs`, and files are grouped by the feature they support. CSS sits beside the feature's views. Runtime song data stays in `data/`.

Shared palette and control tokens live in `dist/app/base.css`. `dist/app/controls.css` defines primary, secondary, destructive, icon, and text buttons with consistent hover, focus, and disabled states. `dist/app/surfaces.css` supplies shared panel backgrounds, borders, headers, and footers. Feature styles control layout and compact sizing without overriding button colors. Actions use native buttons, including downloads; the browser handles the audio attachment directly. Contrast tests read the CSS tokens and check primary and destructive button colors across preset and Magic palettes. Secondary buttons share the filter text and border colors.

The local server serves only browser assets from the public feature folders. Backend modules, workflow JSON, schemas, tools and tests cannot be fetched from the website. The service starts at `dist/server/studio-server.mjs`; `npm start` and the PowerShell launchers use that entry.

The studio separates page layout, editor rendering, submission actions and reference-audio controls. Shared song status rules live in `dist/songs/song-status.js`. Names such as `SongService`, `processNextSong`, `prepareSongWorkflow`, `requestStudio`, and `renderStudioPage` describe their roles directly. Delegated events remain scoped to the stable application and dialog containers; global keyboard shortcuts use `document`.

Song writing uses **GPT-6.1 Sol (`gpt-6.1-sol`) with high reasoning** through the signed-in Codex CLI. A single prompt, `dist/generation/lyrics/song-completion-prompt.mjs`, serves both Auto complete and preparation before composition. `song-completion-schema.mjs` builds each job’s output schema: title, style, and lyrics are requested only when missing, and genre tags when missing or the style has changed. Existing fields are context and are omitted from the response. The generated schema is saved as `response-schema.json` in the job folder. It asks for YuE2 format and English text with English section tags, and adds phrase guidance when a reference score exists. If the idea requests another language, the lyrics preserve that language in Latin transliteration. Title, style, and genre tags stay in English. The parser and planner beside the prompt support SheetSage2's native ABC dialect, not arbitrary ABC files. ComfyUI tools are disabled for song writing.

When details are missing before composition, Encore uses the same completion prompt with GPT-6 Luna at medium reasoning for the needed title, style, or genre tags. The service then reads a clean API graph from `dist/generation/workflows/`, supplies the confirmed style and lyrics, a fresh seed, and an owned output filename prefix. `yue2-song-from-style-and-lyrics` has eight nodes and plans its own ABC score; `yue2-song-from-reference-abc` has seven nodes and receives the chord-free melody score derived from the entity's reference. Both retain the YuE2 checkpoint, 32 DPM-2 sampling steps, SGM uniform scheduler, and lossless audio output. The latent length is connected to the generator's actual output.

Exactly one `POST /prompt` validates and queues the graph. The service stores ComfyUI's returned ID, confirms its output prefix in the queue or history, polls its progress, and imports the finished audio. Validation and execution errors are reported with their details. Failed or uncertain submissions are never automatically retried or replaced. Audio generation requires ComfyUI and its workflow, a prepared reference score when using a reference sample, and Codex when song metadata needs to be generated. Cancellation and deletion stop the tracked ComfyUI job directly through the API.

The service listens on local loopback and the active NetBird `wt` tunnel addresses. Remote access is controlled by NetBird and the computer's firewall. Encore has no application login, session handshake, hostname allowlist, or origin allowlist. The browser uses the same origin as the page, so any working hostname or address can be used. APIs allow cross-origin requests. File-path checks, private-source blocking, upload limits, and deletion confirmation remain in place.

## Development

Run `npm ci` for development; Prettier is the only package dependency. `npm run format` formats the source, and `npm run format:check` checks it. `npm run check` checks JavaScript syntax and imports. `npm test` covers the unified entity, independent copies, regeneration, cancellation, safe deletion, restart recovery, routes, browser templates, and audio import/encoding through a simulated ComfyUI server. Audio tests use the runtime ffmpeg/ffprobe prerequisites and do not generate music or call Codex.

`node dist/tools/check-studio-service.mjs` checks the running service, browser assets, private-source blocking, direct API access, media when available, and playlist persistence. It creates and deletes its own temporary playlist. `node dist/tools/check-codex-login.mjs` checks CLI sign-in without sending a prompt or generating music.
