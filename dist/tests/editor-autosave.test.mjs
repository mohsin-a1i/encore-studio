import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { querySelector: () => null };
globalThis.sessionStorage = { getItem: () => null };
globalThis.localStorage = { getItem: () => null };
globalThis.location = {
  origin: 'http://localhost:4318',
  href: 'http://localhost:4318/',
};
const { studioState, songEdits } = await import('../app/browser-state.js');
const { createEditorAutosave } = await import('../studio/editor-autosave.js');
const form = { dataset: { id: 'song' } };

beforeEach(() => {
  studioState.profileId = 'guest';
  studioState.songs = [
    {
      id: 'song',
      status: 'ready',
      audio: 'current.mp3',
      style: 'Pop',
      lyrics: 'Words',
    },
  ];
  songEdits.clear();
});

test('editor changes save without generating or changing the available audio', async () => {
  const requests = [];
  songEdits.set('song', {
    style: 'Rock',
    lyrics: 'New words',
    referenceMode: 'link',
  });
  const { scheduleEditorSave, flushEditorSave } = createEditorAutosave({
    requestStudio: async (route, options) => {
      const input = JSON.parse(options.body);
      requests.push({ route, options, input });
      return { ...studioState.songs[0], ...input };
    },
  });
  scheduleEditorSave(form);
  await flushEditorSave(form);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].route, 'songs/song');
  assert.equal(requests[0].options.method, 'PATCH');
  assert.deepEqual(requests[0].input, {
    style: 'Rock',
    lyrics: 'New words',
    baseRevision: 0,
  });
  assert.equal(studioState.songs[0].audio, 'current.mp3');
  assert.equal(studioState.songs[0].lyrics, 'New words');
  assert.deepEqual(songEdits.get('song'), { referenceMode: 'link' });
});

test('in-flight saves preserve newer edits and flush waits for the latest version', async () => {
  const calls = [];
  let release;
  const first = new Promise((resolve) => {
    release = resolve;
  });
  const { flushEditorSave } = createEditorAutosave({
    requestStudio: async (_route, options) => {
      const input = JSON.parse(options.body);
      calls.push(input);
      if (calls.length === 1) await first;
      return { ...studioState.songs[0], ...input };
    },
  });
  songEdits.set('song', { lyrics: 'First edit' });
  const initial = flushEditorSave(form);
  while (!calls.length) await new Promise((resolve) => setImmediate(resolve));
  songEdits.set('song', { lyrics: 'Final edit' });
  const final = flushEditorSave(form);
  release();
  await Promise.all([initial, final]);
  assert.deepEqual(calls, [
    { lyrics: 'First edit', baseRevision: 0 },
    { lyrics: 'Final edit', baseRevision: 0 },
  ]);
  assert.equal(studioState.songs[0].lyrics, 'Final edit');
  assert.equal(studioState.songs[0].audio, 'current.mp3');
  assert.equal(songEdits.has('song'), false);
});

test('upload saves are not duplicated when generation flushes an in-flight save', async () => {
  globalThis.FileReader = class {
    readAsDataURL() {
      this.result = 'data:audio/mpeg;base64,YXVkaW8=';
      queueMicrotask(() => this.onload());
    }
  };
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
  const { flushEditorSave } = createEditorAutosave({
    requestStudio: async (_route, options) => {
      calls.push(JSON.parse(options.body));
      await gate;
      return {
        ...studioState.songs[0],
        sampleTitle: 'reference.mp3',
        sampleAudio: 'sample.mp3',
        sampleKind: 'upload',
      };
    },
  });
  songEdits.set('song', {
    sampleUpload: { name: 'reference.mp3', size: 5 },
    sampleUrl: '',
    removeSample: false,
  });
  const initial = flushEditorSave(form);
  while (!calls.length) await new Promise((resolve) => setImmediate(resolve));
  const generationFlush = flushEditorSave(form);
  release();
  await Promise.all([initial, generationFlush]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sampleUpload.data, 'YXVkaW8=');
  assert.equal(studioState.songs[0].audio, 'current.mp3');
  assert.equal(songEdits.has('song'), false);
});

test('a failed save retains local edits for the next explicit save', async () => {
  songEdits.set('song', { sampleUrl: 'https://youtu.be/BaW_jenozKc' });
  const { flushEditorSave } = createEditorAutosave({
    requestStudio: async () => {
      throw new Error('Offline');
    },
  });
  await assert.rejects(flushEditorSave(form), /Offline/);
  assert.equal(songEdits.get('song').sampleUrl, 'https://youtu.be/BaW_jenozKc');
  assert.equal(studioState.songs[0].audio, 'current.mp3');
});

test('the first meaningful edit creates one durable draft even when saves overlap', async () => {
  const draft = { dataset: {}, removeAttribute() {}, isConnected: true };
  studioState.selectedSongId = null;
  studioState.draftRequestId = null;
  Object.assign(studioState, {
    draftTitle: 'New title',
    draftStyle: '',
    draftLyrics: '',
    sampleUrl: '',
    sampleUpload: null,
    removeSample: false,
  });
  const calls = [];
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const saver = createEditorAutosave({
    requestStudio: async (route, options) => {
      calls.push({
        route,
        input: JSON.parse(options.body),
        id: options.headers['X-Request-Id'],
      });
      await gate;
      return {
        id: 'created',
        status: 'draft',
        title: 'New title',
        style: '',
        lyrics: '',
        editRevision: 0,
      };
    },
  });
  const first = saver.flushEditorSave(draft);
  while (!calls.length) await new Promise((resolve) => setImmediate(resolve));
  const second = saver.flushEditorSave(draft);
  release();
  await Promise.all([first, second]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.kind, 'draft');
  assert.equal(draft.dataset.id, 'created');
  assert.equal(studioState.selectedSongId, 'created');
});
test('a blank New song does not create a record', async () => {
  Object.assign(studioState, {
    draftTitle: '',
    draftStyle: '',
    draftLyrics: '',
    sampleUrl: '',
    sampleUpload: null,
  });
  let calls = 0;
  const saver = createEditorAutosave({
    requestStudio: async () => {
      calls++;
    },
  });
  await saver.flushEditorSave({ dataset: {} });
  assert.equal(calls, 0);
});
test('a conflict preserves a recovery copy until the user deliberately reapplies edits', async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  songEdits.set('song', { lyrics: 'My words', _baseRevision: 0 });
  studioState.songs[0].editRevision = 1;
  const sent = [];
  let fail = true;
  const saver = createEditorAutosave({
    requestStudio: async (route, options) => {
      const data = JSON.parse(options.body);
      sent.push(data);
      if (fail) throw Object.assign(new Error('Changed elsewhere'), { status: 409 });
      return { ...studioState.songs[0], lyrics: data.lyrics, editRevision: 2 };
    },
  });
  await assert.rejects(saver.flushEditorSave(form), { status: 409 });
  assert.equal(songEdits.get('song').lyrics, 'My words');
  assert.ok(values.has('encore-device:guest:recovery:song'));
  await assert.rejects(saver.flushEditorSave(form), { status: 409 });
  assert.equal(sent.length, 1, 'blur must not retry or hide unresolved conflicts');
  fail = false;
  await saver.resolveEditorConflict(form, true);
  assert.equal(sent[1].baseRevision, 1);
  assert.equal(studioState.songs[0].lyrics, 'My words');
  assert.ok(!values.has('encore-device:guest:recovery:song'));
});
