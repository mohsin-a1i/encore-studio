import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { querySelector: () => ({}) };
globalThis.sessionStorage = { getItem: () => null };
globalThis.localStorage = { getItem: () => null };
globalThis.location = { hostname: 'localhost', origin: 'http://localhost:4318' };
const { studioState, songEdits, getPlayableSongs, reconcileSongEdits } =
  await import('../app/browser-state.js');
const { renderStudioPage, refreshStudioPage } = await import('../studio/studio-page.js');
const { updateEditorControls } = await import('../studio/editor-view.js');
const { handleReferenceSourceChange, clearReferenceSelection, recordEditorInput } =
  await import('../studio/reference-controls.js');
const { getFilteredSongs, renderLibraryFilters } = await import('../library/library-page.js');

const savedSong = () => ({
  id: 'saved',
  title: 'Evening',
  style: 'Soft pop',
  lyrics: '[Verse]\nStay a little longer',
  genres: ['Pop'],
  status: 'draft',
});
beforeEach(() => {
  Object.assign(studioState, {
    songs: [savedSong()],
    selectedSongId: 'saved',
    draftTitle: '',
    draftStyle: '',
    draftLyrics: '',
    sampleUrl: '',
    sampleUpload: null,
    removeSample: false,
    referenceMode: 'link',
    health: { coverWorkflow: true },
    studioQuery: '',
    studioFilter: 'all',
    view: 'create',
    query: '',
    filter: 'All',
  });
  songEdits.clear();
  studioState.editorSections.clear();
});

function editorForm(song, controls = {}) {
  return {
    dataset: { id: song.id },
    elements: {
      ...Object.fromEntries(
        ['title', 'style', 'lyrics', 'sampleUrl'].map((key) => [key, { value: song[key] || '' }]),
      ),
      sampleUpload: { value: '' },
    },
    querySelector: (selector) => controls[selector],
    querySelectorAll: () => [],
  };
}

test('an empty Studio collection shows only the New song button', () => {
  studioState.songs = [];
  studioState.selectedSongId = null;
  const html = renderStudioPage();
  assert.match(html, /data-action="new-song"/);
  assert.doesNotMatch(html, /Your first spark belongs here|Start with New song|session-empty/);
});

test('library and favorites retain matching search and wrapping genre filters', () => {
  studioState.songs = [
    { id: 'one', title: 'Song', genres: ['Rock & Roll', 'Indie'], audio: 'audio/one', liked: true },
    { id: 'two', genres: ['Jazz'], audio: 'audio/two' },
  ];
  studioState.view = 'library';
  assert.match(renderLibraryFilters(), /class="collection-search library-search"/);
  assert.match(renderLibraryFilters(), /Rock &amp; Roll/);
  assert.match(renderLibraryFilters(), /Indie/);
  studioState.filter = 'Indie';
  assert.deepEqual(
    getFilteredSongs().map((song) => song.id),
    ['one'],
  );
  studioState.filter = 'All';
  studioState.view = 'favorites';
  assert.doesNotMatch(renderLibraryFilters(), />Jazz<\/button>/);
  assert.doesNotMatch(renderLibraryFilters(), /scroll-genres|Find your sound|>Genres</);
});

test('every editable song and new song shows all three sections without an idea section or progress tracker', () => {
  for (const selectedSongId of ['saved', null]) {
    studioState.selectedSongId = selectedSongId;
    const html = renderStudioPage();
    assert.deepEqual(
      [...html.matchAll(/data-editor-section="([^"]+)"/g)].map((match) => match[1]),
      ['reference', 'style', 'lyrics'],
    );
    for (const name of ['style', 'lyrics']) {
      assert.match(html, new RegExp(`name="${name}"`));
      assert.doesNotMatch(html, new RegExp(`<textarea[^>]+name="${name}"[^>]+disabled`));
    }
    assert.doesNotMatch(
      html,
      /Original Idea|Waiting for Idea|song-timeline|song-workflow|name="idea"|studio-idle/,
    );
    assert.match(html, /data-action="auto-complete"/);
    assert.match(html, /data-audio-action/);
    assert.equal((html.match(/data-action="new-song"/g) || []).length, 1);
  }
});

test('missing lyrics remain actionable and guidance appears only in the lyrics section', () => {
  const song = studioState.songs[0];
  song.audio = 'audio/current';
  const error = { hidden: true };
  const controls = {
    '[data-auto-complete]': { disabled: false },
    '[data-audio-action]': { disabled: false },
    '[data-song-play]': { disabled: false },
    '[data-song-download]': { disabled: false },
    '[data-lyrics-error]': error,
  };
  const form = editorForm(song, controls);
  updateEditorControls(form);
  assert.equal(controls['[data-audio-action]'].disabled, false);
  assert.equal(controls['[data-song-play]'].disabled, false);
  assert.equal(controls['[data-song-download]'].disabled, false);
  let html = renderStudioPage();
  assert.doesNotMatch(html, /data-editor-note|Regenerating lyrics will replace/);
  assert.match(html, /data-lyrics-error role="alert" hidden/);
  assert.match(html, /aria-describedby="song-lyrics-help"/);

  form.elements.lyrics.value = '  ';
  updateEditorControls(form);
  assert.equal(controls['[data-audio-action]'].disabled, false);
  assert.equal(controls['[data-audio-action]'].className, 'button secondary');
  assert.equal(error.hidden, true);

  error.hidden = false;
  let removed;
  form.elements.lyrics.removeAttribute = (attribute) => (removed = attribute);
  form.elements.lyrics.value = 'A line';
  updateEditorControls(form);
  assert.equal(error.hidden, true);
  assert.equal(removed, 'aria-invalid');
  assert.equal(controls['[data-audio-action]'].className, 'button');

  songEdits.set(song.id, { lyrics: '' });
  html = renderStudioPage();
  assert.doesNotMatch(html.match(/<button(?=[^>]*data-audio-action)[^>]*>/)[0], /disabled/);
});
test('generation keeps the animated writing and composing views and only offers Stop', () => {
  const song = studioState.songs[0];
  song.cover = 'api/cover/song/saved';
  song.audio = 'api/audio/saved';
  for (const [phase, kind] of [
    ['queued', 'lyrics'],
    ['downloading', 'lyrics'],
    ['lyrics', 'lyrics'],
    ['queued', 'audio'],
    ['rendering', 'audio'],
    ['saving', 'audio'],
  ]) {
    Object.assign(song, { status: kind, idea: 'A fleeting idea', job: { id: 'job', kind, phase } });
    const editor = renderStudioPage().match(/<form[\s\S]*?<\/form>/)[0];
    assert.match(editor, /class="generation-scene"/);
    assert.equal((editor.match(/<button\b/g) || []).length, 1);
    assert.match(editor, new RegExp(kind === 'lyrics' ? 'Stop Completing' : 'Stop Composing'));
    assert.doesNotMatch(editor, /song-timeline|data-action="copy-song"/);
    if (kind === 'lyrics') assert.match(editor, /A fleeting idea/);
    else assert.doesNotMatch(editor, /A fleeting idea/);
  }
});

test('reference source switching preserves the sample preview and never exposes notation', () => {
  const song = studioState.songs[0];
  Object.assign(song, {
    sampleKind: 'upload',
    sampleUrl: '',
    sampleTitle: 'My reference',
    sampleAudio: 'api/sample/saved',
    referenceABC: 'X:1\nK:C\nCDEF|',
  });
  const preview = { hidden: false, querySelector: () => ({ pause() {} }) };
  const form = editorForm(song, { '[data-sample-preview-container]': preview });
  for (const mode of ['link', 'upload']) {
    handleReferenceSourceChange({
      target: { name: 'referenceMode', value: mode, closest: () => form },
    });
    assert.equal(preview.hidden, false);
    assert.equal(songEdits.get(song.id).referenceMode, mode);
  }
  assert.doesNotMatch(renderStudioPage(), /ABC notation|CDEF/);
  clearReferenceSelection(form);
  assert.equal(preview.hidden, true);
  assert.equal(songEdits.get(song.id).removeSample, true);
});

test('choosing an audio file starts loading and shows delete only when a file exists', () => {
  const song = studioState.songs[0];
  song.sampleUrl = 'https://youtu.be/BaW_jenozKc';
  songEdits.set(song.id, { referenceMode: 'upload' });
  let html = renderStudioPage();
  assert.match(html.match(/<button[^>]*data-clear-reference[^>]*>/)?.[0] || '', /hidden/);

  const form = editorForm(song);
  const file = { name: 'My melody.wav', size: 1024 };
  let loadingForm;
  handleReferenceSourceChange(
    { target: { name: 'sampleUpload', files: [file], closest: () => form } },
    (selectedForm) => {
      loadingForm = selectedForm;
    },
  );
  assert.equal(loadingForm, form);
  assert.equal(songEdits.get(song.id).sampleUpload, file);
  html = renderStudioPage();
  assert.doesNotMatch(html.match(/<button[^>]*data-clear-reference[^>]*>/)?.[0] || '', /hidden/);
});

test('reference controls show melody progress and failures inside the editor', () => {
  const song = studioState.songs[0];
  song.sampleUrl = 'https://www.youtube.com/watch?v=BaW_jenozKc';
  let html = renderStudioPage();
  assert.match(html, /data-action="prepare-reference"/);
  assert.match(html, />Load<\/span>/);
  assert.match(html, /data-reference-progress[^>]*hidden/);

  song.referencePreparation = { phase: 'preparing' };
  html = renderStudioPage();
  assert.match(html, /Waiting for ComfyUI or reading your reference…/);
  assert.match(html, /data-reference-prepare[^>]*disabled/);
  assert.match(html, /data-loading="true"/);
  assert.match(html, /aria-label="Loading reference audio"/);

  song.referencePreparation = { phase: 'queued' };
  html = renderStudioPage();
  assert.match(html, /Waiting for other work in ComfyUI to finish…/);

  song.referencePreparation = { outcome: 'failed', error: 'Could not read <the melody>' };
  html = renderStudioPage();
  assert.match(html, /Could not read &lt;the melody&gt;/);
  assert.match(html, /data-reference-error\s+role="alert"/);

  song.referencePreparation = { outcome: 'complete' };
  song.referencePrepared = true;
  html = renderStudioPage();
  assert.match(html.match(/<button[^>]*data-reference-prepare[^>]*>/)?.[0] || '', /hidden/);
  assert.doesNotMatch(html, /Reference loaded/);
});

test('untitled songs and new drafts have an editable title without other blank metadata', () => {
  const song = studioState.songs[0];
  song.job = { id: 'written', kind: 'lyrics', outcome: 'complete' };
  songEdits.set(song.id, { lyrics: 'Old edits', _lyricsJobId: 'written' });
  reconcileSongEdits(song);
  assert.equal(songEdits.has(song.id), false);
  Object.assign(song, { title: '', genres: [], cover: null });
  let html = renderStudioPage();
  assert.match(html, /name="title" value="" placeholder="Song title"/);
  assert.doesNotMatch(html, /song-header-meta|song-cover-control/);
  Object.assign(song, {
    title: 'Dawn',
    genres: ['Rock', 'Indie'],
    duration: 123,
    cover: 'api/cover/song/saved',
  });
  html = renderStudioPage();
  assert.match(html, /value="Dawn"/);
  assert.match(html, />Rock<\/span>/);
  assert.match(html, />Indie<\/span>/);
  assert.match(html, /2:03/);
  assert.match(html, /class="song-cover-control"/);

  studioState.selectedSongId = null;
  html = renderStudioPage();
  assert.match(html, /name="title" value="" placeholder="Song title"/);
  const form = editorForm({ id: '' });
  form.hasAttribute = (name) => name === 'data-new-song';
  recordEditorInput({ name: 'title', value: 'A new title', closest: () => form });
  assert.equal(studioState.draftTitle, 'A new title');
  assert.match(renderStudioPage(), /name="title" value="A new title"/);
});

test('studio lists all songs while the library only lists playable songs', () => {
  studioState.songs.push(
    { id: 'failed', status: 'draft', job: { kind: 'lyrics', outcome: 'failed' } },
    { id: 'ready', status: 'ready', audio: 'ready.mp3' },
  );
  assert.deepEqual(
    getPlayableSongs().map((song) => song.id),
    ['ready'],
  );
  assert.deepEqual(
    getFilteredSongs().map((song) => song.id),
    ['ready'],
  );
  const html = renderStudioPage();
  for (const song of studioState.songs) assert.ok(html.includes(`data-id="${song.id}"`));
});

test('filtering and polling preserve the selected editor and focused text edits', () => {
  studioState.studioQuery = 'no matching song';
  studioState.studioFilter = 'lyrics';
  assert.match(renderStudioPage(), /No songs match this view/);
  assert.match(renderStudioPage(), /name="lyrics"/);
  const previousDocument = globalThis.document;
  const editor = { dataset: { key: 'old' }, contains: () => true, innerHTML: 'Unsaved editor' };
  globalThis.document = {
    activeElement: { tagName: 'TEXTAREA', disabled: false },
    querySelector: (selector) => (selector === '#studio-editor' ? editor : null),
  };
  try {
    refreshStudioPage();
    assert.equal(editor.innerHTML, 'Unsaved editor');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('Auto complete hides for complete songs and reappears when a required field is cleared', () => {
  const song = studioState.songs[0];
  const button = {};
  const form = editorForm(song, { '[data-auto-complete]': button });
  updateEditorControls(form);
  assert.equal(button.hidden, true);
  assert.match(renderStudioPage(), /data-auto-complete data-action="auto-complete" hidden/);
  for (const field of ['title', 'style', 'lyrics']) {
    form.elements[field].value = '';
    updateEditorControls(form);
    assert.equal(button.hidden, false, field);
    form.elements[field].value = song[field];
  }
  form.elements.style.value = 'Jazz';
  updateEditorControls(form);
  assert.equal(button.hidden, false);
  form.elements.style.value = song.style;
  song.genres = [];
  updateEditorControls(form);
  assert.equal(button.hidden, false);
});
