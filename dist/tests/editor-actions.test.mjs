import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const modalRoot = { innerHTML: '', querySelector: () => null };
let currentEditor;
globalThis.document = {
  body: { style: {} },
  querySelector: (selector) =>
    selector === '#modal-root'
      ? modalRoot
      : selector === '#song-editor-form'
        ? currentEditor
        : { classList: { add() {}, remove() {} } },
};
globalThis.sessionStorage = { getItem: () => null, setItem() {} };
globalThis.localStorage = { getItem: () => null };
globalThis.location = { origin: 'http://localhost:4318', href: 'http://localhost:4318/' };
const { studioState, songEdits } = await import('../app/browser-state.js');
const { createEditorActions } = await import('../studio/editor-actions.js');
const { openAutoCompleteDialog } = await import('../studio/auto-complete-dialog.js');
const { allowGenerationWithReference } = await import('../studio/reference-controls.js');

beforeEach(() => {
  Object.assign(studioState, {
    profileId: 'guest',
    connected: true,
    songs: [],
    selectedSongId: null,
    modal: null,
    sampleUrl: '',
    sampleUpload: null,
    removeSample: false,
    draftStyle: '',
    draftLyrics: '',
    draftTitle: '',
    pending: false,
  });
  songEdits.clear();
});

function form(id = '', values = {}) {
  const buttons = [{ disabled: false }];
  return {
    dataset: { id },
    elements: Object.fromEntries(
      Object.entries({ title: '', style: '', lyrics: '', sampleUrl: '', ...values }).map(
        ([key, value]) => [key, { value }],
      ),
    ),
    querySelectorAll: (selector) => (selector === 'button' ? buttons : []),
    querySelector: () => null,
    setAttribute() {},
    buttons,
  };
}

test('the idea modal submits the idea and musical style for a new song', async () => {
  const calls = [];
  currentEditor = form('', { title: 'My first song', style: 'Soft piano and strings' });
  openAutoCompleteDialog(currentEditor);
  assert.match(modalRoot.innerHTML, /id="auto-complete-form"/);
  assert.match(modalRoot.innerHTML, /name="idea"/);
  assert.doesNotMatch(modalRoot.innerHTML, /<textarea[^>]*required/);
  assert.match(modalRoot.innerHTML, /using your music style/);
  assert.doesNotMatch(modalRoot.innerHTML, /Try an idea|data-action="inspiration"|class="chip/);
  const entity = {
    id: 'new-song',
    status: 'lyrics',
    idea: 'A fleeting request',
    job: { id: 'new-job', kind: 'lyrics', phase: 'queued' },
  };
  const actions = createEditorActions({
    requestStudio: async (route, options) => {
      calls.push({ route, body: JSON.parse(options.body) });
      return entity;
    },
    refreshLibrary: async () => {
      studioState.songs = [entity];
    },
    renderApplication() {},
  });
  await actions.startAutoCompletion(form('', { idea: 'A fleeting request' }));
  assert.equal(calls[0].route, 'songs');
  assert.deepEqual(calls[0].body, {
    idea: 'A fleeting request',
    kind: 'lyrics',
    title: 'My first song',
    style: 'Soft piano and strings',
    lyrics: '',
    sampleUrl: '',
    removeSample: false,
  });
  assert.equal(entity.idea, 'A fleeting request');
  assert.equal(studioState.selectedSongId, 'new-song');
  assert.equal(studioState.modal, null);
});

test('the lyric modal shows the saved idea safely for editing', () => {
  studioState.songs = [{ id: 'saved', idea: 'A <new> idea & a melody', style: 'Pop' }];
  currentEditor = form('saved', { style: 'Pop' });
  openAutoCompleteDialog(currentEditor);
  assert.match(modalRoot.innerHTML, /A &lt;new&gt; idea &amp; a melody<\/textarea>/);
});

test('an unloaded reference opens its section and explains how to continue', () => {
  const editor = form('', { sampleUrl: 'https://youtu.be/BaW_jenozKc' });
  const section = {
    open: false,
    scrollIntoView(options) {
      this.scrolledWith = options;
    },
  };
  const error = { hidden: true, textContent: '' };
  const button = {
    focus() {
      this.focused = true;
    },
  };
  editor.querySelector = (selector) =>
    ({
      '[data-editor-section="reference"]': section,
      '[data-reference-error]': error,
      '[data-reference-prepare]': button,
    })[selector] || null;
  assert.equal(allowGenerationWithReference(editor), false);
  assert.equal(section.open, true);
  assert.equal(section.scrolledWith.block, 'center');
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, 'Load or delete the reference URL before continuing.');
  assert.equal(button.focused, true);
});

test('generating without lyrics opens the section, shows guidance and makes no request', async () => {
  const editor = form('', { lyrics: '  ' });
  const section = { open: false };
  const error = {
    hidden: true,
    scrollIntoView(options) {
      this.scrolledWith = options;
    },
  };
  const lyrics = editor.elements.lyrics;
  lyrics.setAttribute = (name, value) => {
    lyrics[name] = value;
  };
  lyrics.focus = (options) => {
    lyrics.focusedWith = options;
  };
  editor.querySelector = (selector) =>
    ({
      '[data-editor-section="lyrics"]': section,
      '[data-lyrics-error]': error,
    })[selector] || null;
  let requests = 0;
  let saves = 0;
  const actions = createEditorActions({
    requestStudio: async () => {
      requests++;
    },
    flushEditorSave: async () => {
      saves++;
    },
    refreshLibrary: async () => {},
    renderApplication() {},
  });
  await actions.startEditorGeneration(editor, 'audio');
  assert.equal(section.open, true);
  assert.equal(error.hidden, false);
  assert.equal(error.scrolledWith.block, 'center');
  assert.equal(lyrics['aria-invalid'], 'true');
  assert.equal(lyrics.focusedWith.preventScroll, true);
  assert.equal(requests, 0);
  assert.equal(saves, 0);
  assert.equal(editor.buttons[0].disabled, false);
});

test('manual style and lyrics can create audio directly without lyric writing', async () => {
  const calls = [];
  const editor = form('', { style: 'Rock', lyrics: '[Verse]\nMy own words' });
  const song = {
    id: 'manual-song',
    status: 'audio',
    style: 'Rock',
    lyrics: '[Verse]\nMy own words',
    job: { kind: 'audio' },
  };
  const actions = createEditorActions({
    requestStudio: async (route, options) => {
      calls.push({ route, body: JSON.parse(options.body) });
      return song;
    },
    refreshLibrary: async () => {
      studioState.songs = [song];
    },
    renderApplication() {},
  });
  await actions.startEditorGeneration(editor, 'audio');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.kind, 'audio');
  assert.equal('idea' in calls[0].body, false);
  assert.equal(calls[0].body.lyrics, song.lyrics);
  assert.equal(studioState.selectedSongId, song.id);
});

test('a failed lyric submission keeps the idea modal open and restores its controls', async () => {
  currentEditor = form('existing');
  studioState.songs = [{ id: 'existing', status: 'draft', style: 'Pop', lyrics: 'Words' }];
  openAutoCompleteDialog(currentEditor);
  const dialog = form('existing', { idea: 'Try this feeling' });
  const actions = createEditorActions({
    requestStudio: async () => {
      throw new Error('Offline');
    },
    refreshLibrary() {},
    renderApplication() {},
  });
  await assert.rejects(actions.startAutoCompletion(dialog), /Offline/);
  assert.equal(studioState.modal.kind, 'auto-complete');
  assert.equal(dialog.elements.idea.value, 'Try this feeling');
  assert.equal(dialog.buttons[0].disabled, false);
  assert.equal(currentEditor.buttons[0].disabled, false);
});
