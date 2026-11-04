# Song completion

When Auto complete or Explore needs new lyrics, the prompt includes the song's previous lyrics and recent lyrics from the same profile as examples to avoid. It asks for a different story, imagery, hook, phrasing, and rhyme patterns while following the current idea. Cleared or replaced lyrics are retained internally for this purpose. Prior examples are deduplicated and limited to five excerpts and 30,000 characters total. This contrast section is omitted whenever lyrics are already provided; those lyrics are preserved.

One prompt in song-completion-prompt.mjs serves Auto complete and preparation before composition. It uses the idea, title, lyrics, music style, genre tags, and any reference timing guide as context. song-completion-schema.mjs requests only missing fields, plus genre tags that need refreshing after a style change. Existing fields are omitted from the response and preserved by the service. Completed songs skip Codex entirely.

Auto complete uses GPT-6.1 Sol with high reasoning. Generate Song requires lyrics and uses GPT-6 Luna at medium reasoning to fill missing title, style, and genre tags. ComfyUI receives the completed musical style, existing lyrics, and the reference ABC notation when present. There are no automatic retries or extra planning calls.

The reference workflow produces ABC notation. reference-lyrics-guide.mjs reduces it to tempo, ordered sections, and broad singing windows. Short rests and barlines stay inside a window; longer gaps remain room for instruments and effects. The prompt asks for natural sentences without awkward pauses and room between vocals for music and effects. English metadata and section tags are used, with Latin transliteration for other lyric languages.

The idea is saved on the song and shown in the Auto complete modal. Each operation saves its dynamic response-schema.json and reference-guide.json when used. Copies retain the saved material. Editing or completing fields preserves existing audio; composition replaces it only after a new recording is ready. Neither notation nor its timing guide appears in the UI.
