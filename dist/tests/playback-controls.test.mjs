import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMediaSessionControls } from '../playback/media-session.js';

function element() {
  return {
    innerHTML: '',
    dataset: {},
    style: {},
    handlers: new Map(),
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener(name, handler) {
      const handlers = this.handlers.get(name) || [];
      this.handlers.set(name, [...handlers, handler]);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    focus() {},
  };
}

const audio = {
  ...element(),
  currentTime: 0,
  duration: 120,
  playbackRate: 1,
  paused: true,
  ended: false,
  playCalls: 0,
  pauseCalls: 0,
  volume: 0.7,
  get src() {
    return this.source || '';
  },
  set src(value) {
    this.source = value;
    this.currentTime = 0;
    this.ended = false;
  },
  async play() {
    this.playCalls++;
    this.paused = false;
    this.ended = false;
    this.emit('play');
  },
  pause() {
    this.pauseCalls++;
    this.paused = true;
    this.emit('pause');
  },
  emit(name) {
    this.handlers.get(name)?.forEach((handler) => handler());
  },
  removeAttribute() {
    this.src = '';
  },
  load() {},
};
const app = element(),
  modalRoot = element(),
  coverInput = element(),
  toast = element();
const documentHandlers = new Map();
globalThis.document = {
  documentElement: { dataset: {}, style: { setProperty() {} } },
  body: { style: {} },
  activeElement: { tagName: 'BODY' },
  querySelector: (selector) =>
    ({
      '#app': app,
      '#audio': audio,
      '#modal-root': modalRoot,
      '#cover-file': coverInput,
      '#toast': toast,
    })[selector] || null,
  querySelectorAll: () => [],
  addEventListener(name, handler) {
    const handlers = documentHandlers.get(name) || [];
    documentHandlers.set(name, [...handlers, handler]);
  },
  removeEventListener(name, handler) {
    documentHandlers.set(
      name,
      (documentHandlers.get(name) || []).filter((item) => item !== handler),
    );
  },
};
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.location = {
  hostname: 'localhost',
  origin: 'http://localhost:4318',
  href: 'http://localhost:4318/',
  hash: '#song/b',
};
const windowHandlers = new Map();
globalThis.window = {
  addEventListener: (name, handler) => windowHandlers.set(name, handler),
  scrollTo() {},
};
const mediaActions = new Map();
const nativeSession = {
  setActionHandler: (name, handler) => mediaActions.set(name, handler),
  setPositionState(position) {
    this.position = position;
  },
};
Object.defineProperty(globalThis, 'navigator', {
  value: { mediaSession: nativeSession },
  configurable: true,
});
globalThis.MediaMetadata = class {
  constructor(data) {
    Object.assign(this, data);
  }
};

const songs = ['a', 'b', 'c'].map((id) => ({
  id,
  title: `Song ${id}`,
  genre: 'Pop',
  mood: 'Hopeful',
  lyrics: 'Hello',
  audio: `api/audio/${id}`,
  cover: `api/cover/song/${id}`,
  duration: 120,
  status: 'ready',
  liked: id !== 'a',
}));
const playlists = [{ id: 'playlist', name: 'My playlist', songIds: ['c', 'a'] }];
const profiles = [
  { id: 'guest', name: 'Guest' },
  { id: 'other-profile', name: 'Other profile' },
];
let serverProfiles = structuredClone(profiles);
const requests = [];
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url, options });
  const route = new URL(url).pathname;
  if (route.startsWith('/api/profiles/') && options.method === 'PATCH') {
    const profile = serverProfiles.find((item) => item.id === route.split('/').at(-1));
    Object.assign(profile, JSON.parse(options.body));
    return { ok: true, json: async () => structuredClone(profile) };
  }
  if (route.endsWith('/profiles') && options.method === 'POST') {
    const profile = { id: 'new-profile', ...JSON.parse(options.body) };
    serverProfiles.push(profile);
    return { ok: true, json: async () => structuredClone(profile) };
  }
  const data = route.endsWith('/library')
    ? {
        songs: options.headers?.['X-Profile-Id'] === 'other-profile' ? [] : structuredClone(songs),
        playlists:
          options.headers?.['X-Profile-Id'] === 'other-profile' ? [] : structuredClone(playlists),
        profiles: structuredClone(serverProfiles),
        profile:
          serverProfiles.find((item) => item.id === options.headers?.['X-Profile-Id']) ||
          serverProfiles[0],
      }
    : route.endsWith('/profiles')
      ? { profiles: structuredClone(serverProfiles) }
      : { codex: true, comfy: true };
  return { ok: true, json: async () => data };
};
// Start the real application and its delegated playback controls.
await import('../app/browser-app.js');
const { studioState } = await import('../app/browser-state.js');
const sharedLinkStartup = {
  id: studioState.currentId,
  modal: studioState.modal,
  plays: audio.playCalls,
};
const { renderSongList, renderHomePage, renderPlaylistPage, getFilteredSongs } =
  await import('../library/library-page.js');

beforeEach(() => {
  document.visibilityState = 'visible';
  serverProfiles = structuredClone(profiles);
  Object.assign(studioState, {
    profileId: 'guest',
    profile: profiles[0],
    profiles: structuredClone(profiles),
    songs: structuredClone(songs),
    playlists: structuredClone(playlists),
    currentId: null,
    currentAudio: null,
    playing: false,
    queue: [],
    shuffle: false,
    repeat: false,
    modal: null,
    query: '',
    filter: 'All',
    view: 'library',
    playlistId: null,
  });
  audio.paused = true;
  audio.ended = false;
  audio.currentTime = 0;
  audio.duration = 120;
  audio.playbackRate = 1;
  audio.playCalls = audio.pauseCalls = 0;
  modalRoot.innerHTML = '';
  requests.length = 0;
});

async function clickSong(action, id, queue) {
  const table = queue
    ? { querySelectorAll: () => queue.map((songId) => ({ dataset: { id: songId } })) }
    : null;
  const control = {
    dataset: { action, id },
    closest: (selector) => (selector === '.songs-table' ? table : null),
  };
  await app.handlers.get('click')[0]({ target: { closest: () => control }, preventDefault() {} });
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('Explore card toggles playback and follows player and native pause events', async (t) => {
  const temporary = { ...songs[0], id: 'explore', audio: 'api/audio/explore', temporary: true };
  studioState.exploreSongs = [temporary];
  const attributes = {};
  const cardButton = {
    dataset: { id: 'explore' },
    innerHTML: '',
    setAttribute: (key, value) => {
      attributes[key] = String(value);
    },
  };
  const previousQuery = document.querySelectorAll;
  document.querySelectorAll = (selector) => (selector === '[data-song-play]' ? [cardButton] : []);
  t.after(() => {
    document.querySelectorAll = previousQuery;
    studioState.exploreSongs = [];
  });
  await clickSong('play', 'explore');
  assert.equal(audio.paused, false);
  assert.equal(attributes['aria-pressed'], 'true');
  assert.match(cardButton.innerHTML, /Pause/);
  await clickSong('play', 'explore');
  assert.equal(audio.paused, true);
  assert.equal(attributes['aria-pressed'], 'false');
  assert.match(cardButton.innerHTML, /Play song/);
  mediaActions.get('play')();
  await settle();
  assert.equal(attributes['aria-pressed'], 'true');
  mediaActions.get('pause')();
  assert.equal(attributes['aria-pressed'], 'false');
});

test('a shared link opens song details and starts playback after the library loads', () => {
  assert.equal(sharedLinkStartup.id, 'b');
  assert.deepEqual(sharedLinkStartup.modal, { kind: 'song', id: 'b' });
  assert.equal(sharedLinkStartup.plays, 1);
});

test('sharing copies a direct song link and opening another link starts that song', async (t) => {
  const copied = [];
  navigator.clipboard = { writeText: async (text) => copied.push(text) };
  t.after(() => delete navigator.clipboard);
  await clickSong('song', 'a');
  assert.match(modalRoot.innerHTML, /data-action="share-song"/);
  await clickSong('share-song', 'a');
  assert.deepEqual(copied, ['https://encore.eu1.netbird.services/?profile=guest#song/a']);
  location.hash = '#song/c';
  windowHandlers.get('hashchange')();
  await settle();
  assert.equal(studioState.currentId, 'c');
  assert.deepEqual(studioState.modal, { kind: 'song', id: 'c' });
  assert.equal(audio.paused, false);
});

test('a browser autoplay restriction keeps song details open without a play prompt', async (t) => {
  const play = audio.play;
  audio.play = async () => {
    throw Object.assign(new Error('Autoplay blocked'), { name: 'NotAllowedError' });
  };
  t.after(() => {
    audio.play = play;
  });
  toast.textContent = '';
  location.hash = '#song/a';
  windowHandlers.get('hashchange')();
  await settle();
  assert.deepEqual(studioState.modal, { kind: 'song', id: 'a' });
  assert.equal(toast.textContent, '');
});

test('an unavailable shared song shows a helpful message without starting playback', async () => {
  location.hash = '#song/deleted';
  windowHandlers.get('hashchange')();
  await settle();
  assert.equal(audio.playCalls, 0);
  assert.equal(toast.textContent, 'This song is no longer available.');
});

test('switching profiles clears playback and unsaved editor data and loads that profile collection', async () => {
  const { songEdits } = await import('../app/browser-state.js');
  await clickSong('start-song', 'a');
  studioState.draftStyle = 'Unsaved guest style';
  studioState.sampleUpload = { name: 'guest.mp3' };
  studioState.selectedSongId = 'a';
  songEdits.set('a', { lyrics: 'Guest edits' });
  await clickSong('profiles');
  assert.match(modalRoot.innerHTML, /data-action="profile-switch"/);
  assert.match(modalRoot.innerHTML, /class="profile-choice" data-action="profile-switch"/);
  assert.match(modalRoot.innerHTML, /data-action="profile-rename"/);
  assert.doesNotMatch(modalRoot.innerHTML, /data-profile-name|>Switch<\/button>/);
  assert.match(modalRoot.innerHTML, /data-action="profile-delete"/);
  await clickSong('profile-switch', 'other-profile');
  assert.equal(studioState.profile.name, 'Other profile');
  assert.deepEqual(studioState.songs, []);
  assert.deepEqual(studioState.playlists, []);
  assert.equal(studioState.currentId, null);
  assert.equal(audio.paused, true);
  assert.equal(audio.src, '');
  assert.equal(studioState.draftStyle, '');
  assert.equal(studioState.sampleUpload, null);
  assert.equal(studioState.selectedSongId, null);
  assert.equal(songEdits.size, 0);
  await clickSong('profile-switch', 'guest');
  assert.equal(studioState.songs.length, 3);
  assert.equal(studioState.profile.name, 'Guest');
});

function mockProfileForm(t, id, name) {
  const previousFormData = globalThis.FormData;
  globalThis.FormData = class {
    constructor(form) {
      return new Map([['name', form.profileName]]);
    }
  };
  t.after(() => {
    globalThis.FormData = previousFormData;
  });
  const button = { disabled: false };
  return {
    id: 'profile-form',
    dataset: { id },
    profileName: name,
    querySelector: () => button,
    querySelectorAll: () => [button],
  };
}

test('new and edit profiles use separate dialogs and save through their forms', async (t) => {
  await clickSong('profiles');
  assert.doesNotMatch(modalRoot.innerHTML, /id="profile-form"/);
  await clickSong('profile-rename', 'guest');
  assert.match(modalRoot.innerHTML, />Edit profile<\/h2>/);
  assert.match(modalRoot.innerHTML, /value="Guest"/);
  const rename = mockProfileForm(t, 'guest', 'Renamed Guest');
  await modalRoot.handlers.get('submit')[0]({ target: rename, preventDefault() {} });
  assert.equal(studioState.profile.name, 'Renamed Guest');
  assert.equal(studioState.modal.kind, 'profiles');
  assert.match(app.innerHTML, /Renamed Guest/);
  await clickSong('profile-create');
  assert.match(modalRoot.innerHTML, />New profile<\/h2>/);
  assert.match(modalRoot.innerHTML, /id="profile-form" data-id=""/);
  const create = { ...rename, dataset: { id: '' }, profileName: 'Fresh collection' };
  await modalRoot.handlers.get('submit')[0]({ target: create, preventDefault() {} });
  assert.equal(studioState.profileId, 'new-profile');
  assert.equal(studioState.profile.name, 'Fresh collection');
  assert.equal(studioState.modal, null);
});

test('a failed profile edit leaves its dialog open and re-enables saving', async (t) => {
  await clickSong('profile-rename', 'guest');
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Connection lost');
  });
  const form = mockProfileForm(t, 'guest', 'Another name');
  await modalRoot.handlers.get('submit')[0]({ target: form, preventDefault() {} });
  assert.equal(studioState.profile.name, 'Guest');
  assert.equal(studioState.modal.kind, 'profile-form');
  assert.equal(form.querySelector().disabled, false);
  assert.equal(toast.textContent, 'Connection lost');
});
test('the download button requests the native attachment without changing playback', async (t) => {
  const destinations = [];
  location.assign = (url) => destinations.push(url);
  t.after(() => delete location.assign);
  await clickSong('download-song', 'a');
  assert.deepEqual(destinations, ['http://localhost:4318/api/download/a?profile=guest']);
  assert.equal(audio.playCalls, 0);
});

test('song taps start playback in overview, library, favorites, and playlists with the displayed queue', async () => {
  for (const view of ['home', 'library', 'favorites', 'playlist']) {
    studioState.view = view;
    studioState.playlistId = view === 'playlist' ? 'playlist' : null;
    const visible = getFilteredSongs();
    const html =
      view === 'home'
        ? renderHomePage()
        : view === 'playlist'
          ? renderPlaylistPage()
          : renderSongList(visible);
    assert.match(html, /data-song-row\s+data-action="start-song"/);
    assert.match(html, /class="song-name"\s+data-action="start-song"/);
    assert.equal((html.match(/data-action="song"/g) || []).length, visible.length);
    const id = visible[0].id;
    await clickSong(
      'start-song',
      id,
      visible.map((song) => song.id),
    );
    assert.equal(studioState.currentId, id);
    assert.equal(audio.paused, false);
    assert.equal(studioState.modal, null);
    assert.deepEqual(
      studioState.queue,
      visible.map((song) => song.id),
    );
    const pauses = audio.pauseCalls;
    await clickSong(
      'start-song',
      id,
      visible.map((song) => song.id),
    );
    assert.equal(audio.pauseCalls, pauses);
  }
});

test('the three-dot action opens song details without changing playback', async () => {
  await clickSong('start-song', 'a', ['a', 'b', 'c']);
  const plays = audio.playCalls;
  await clickSong('song', 'b', ['a', 'b', 'c']);
  assert.deepEqual(studioState.modal, { kind: 'song', id: 'b' });
  assert.match(modalRoot.innerHTML, /Song b/);
  assert.equal(studioState.currentId, 'a');
  assert.equal(audio.playCalls, plays);
  assert.equal(audio.paused, false);
});

test('headphone next and previous follow the selected queue, skip unavailable songs, and update native metadata', async () => {
  await clickSong('start-song', 'b', ['c', 'b', 'a']);
  studioState.songs.find((song) => song.id === 'a').audio = null;
  mediaActions.get('nexttrack')();
  await settle();
  assert.equal(studioState.currentId, 'c');
  assert.equal(nativeSession.metadata.title, 'Song c');
  assert.equal(audio.title, 'Song c');
  assert.equal(nativeSession.metadata.artwork.length, 6);
  assert.ok(
    nativeSession.metadata.artwork.every(
      (image) => image.type === 'image/png' && image.src.includes('/song/c/media/'),
    ),
  );
  assert.equal(nativeSession.playbackState, 'playing');
  audio.currentTime = 25;
  mediaActions.get('previoustrack')();
  await settle();
  assert.equal(studioState.currentId, 'b');
  assert.equal(nativeSession.metadata.title, 'Song b');
  assert.equal(audio.paused, false);
});

test('headphone play and pause are idempotent and next restarts a one-song queue', async () => {
  await clickSong('start-song', 'a', ['a']);
  mediaActions.get('play')();
  assert.equal(audio.paused, false);
  mediaActions.get('pause')();
  assert.equal(audio.paused, true);
  assert.equal(nativeSession.playbackState, 'paused');
  mediaActions.get('pause')();
  mediaActions.get('play')();
  await settle();
  assert.equal(audio.paused, false);
  audio.currentTime = 40;
  mediaActions.get('nexttrack')();
  await settle();
  assert.equal(studioState.currentId, 'a');
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.paused, false);
  await clickSong('play', 'a', ['a']);
  assert.equal(audio.paused, true); // The explicit play/pause control still toggles.
});

test('player and headset next both invoke the Explore advance hook', async (t) => {
  const { createAudioPlayer } = await import('../playback/audio-player.js');
  const previousAudioHandlers = new Map(
    [...audio.handlers].map(([name, handlers]) => [name, [...handlers]]),
  );
  const previousMediaActions = new Map(mediaActions);
  t.after(() => {
    player.dispose();
    audio.handlers = previousAudioHandlers;
    mediaActions.clear();
    for (const [name, handler] of previousMediaActions) mediaActions.set(name, handler);
  });
  const directions = [];
  const player = createAudioPlayer({
    renderApplication() {},
    onAdvance: (direction) => {
      directions.push(direction);
      return true;
    },
  });
  player.playNextSong();
  mediaActions.get('nexttrack')();
  assert.deepEqual(directions, [1, 1]);
});

test('natural completion advances or repeats without toggling the current song off', async () => {
  await clickSong('start-song', 'a', ['a', 'b']);
  audio.paused = true;
  audio.ended = true;
  audio.emit('ended');
  await settle();
  assert.equal(studioState.currentId, 'b');
  studioState.repeat = true;
  audio.currentTime = 120;
  audio.paused = true;
  audio.ended = true;
  audio.emit('ended');
  await settle();
  assert.equal(studioState.currentId, 'b');
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.paused, false);
});

test('hidden-page completion and OS controls advance the queue without waiting for a visible UI', async () => {
  await clickSong('start-song', 'a', ['a', 'b', 'c']);
  document.visibilityState = 'hidden';
  audio.paused = true;
  audio.ended = true;
  audio.emit('ended');
  assert.equal(studioState.currentId, 'b');
  await settle();
  assert.equal(audio.paused, false);
  assert.equal(nativeSession.metadata.title, 'Song b');
  assert.equal(nativeSession.playbackState, 'playing');
  mediaActions.get('nexttrack')();
  assert.equal(studioState.currentId, 'c');
  await settle();
  mediaActions.get('pause')();
  assert.equal(audio.paused, true);
  mediaActions.get('play')();
  await settle();
  assert.equal(audio.paused, false);
  mediaActions.get('seekto')({ seekTime: 35 });
  assert.equal(audio.currentTime, 35);
  mediaActions.get('previoustrack')();
  await settle();
  assert.equal(studioState.currentId, 'b');
});

test('returning to the page restores missing native handlers without restarting playback', async () => {
  await clickSong('start-song', 'a', ['a', 'b']);
  document.visibilityState = 'hidden';
  audio.currentTime = 37;
  mediaActions.clear();
  nativeSession.metadata = null;
  const plays = audio.playCalls;
  document.visibilityState = 'visible';
  documentHandlers.get('visibilitychange').forEach((handler) => handler());
  assert.equal(audio.playCalls, plays);
  assert.equal(audio.currentTime, 37);
  assert.equal(nativeSession.playbackState, 'playing');
  assert.equal(nativeSession.metadata.title, 'Song a');
  mediaActions.get('nexttrack')();
  await settle();
  assert.equal(studioState.currentId, 'b');
});

test('native seek controls clamp positions and metadata refreshes after rename or removal', async () => {
  await clickSong('start-song', 'b', ['a', 'b']);
  mediaActions.get('seekto')({ seekTime: 999 });
  assert.equal(audio.currentTime, 120);
  mediaActions.get('seekbackward')({ seekOffset: 15 });
  assert.equal(audio.currentTime, 105);
  assert.equal(nativeSession.position.position, 105);
  studioState.songs.find((song) => song.id === 'b').title = 'Renamed song';
  audio.emit('loadedmetadata');
  assert.equal(nativeSession.metadata.title, 'Renamed song');
  studioState.songs.find((song) => song.id === 'b').cover += '?v=new-cover';
  audio.emit('loadedmetadata');
  assert.ok(
    nativeSession.metadata.artwork.every(
      (image) => new URL(image.src).searchParams.get('v') === 'new-cover',
    ),
  );
  studioState.currentId = null;
  audio.emit('emptied');
  assert.equal(nativeSession.metadata, null);
  assert.equal(nativeSession.playbackState, 'none');
  assert.equal(nativeSession.position, undefined);
});

test('unsupported native controls do not prevent the remaining headset handlers or ordinary playback', () => {
  const handlers = new Map();
  const session = {
    setActionHandler(action, handler) {
      if (action === 'seekto') throw new Error('Unsupported');
      handlers.set(action, handler);
    },
    setPositionState() {
      throw new Error('Unsupported');
    },
  };
  let skips = 0;
  const controls = createMediaSessionControls({
    session,
    audio,
    getSong: () => null,
    play() {},
    pause() {},
    next: () => skips++,
    previous() {},
    coverUrl: () => '',
  });
  handlers.get('nexttrack')();
  assert.equal(skips, 1);
  assert.doesNotThrow(controls.sync);
  assert.doesNotThrow(() => createMediaSessionControls({ session: null }).sync());
});

test('invalid artwork and unsupported metadata do not disable native playback state or actions', () => {
  const handlers = new Map();
  const session = {
    setActionHandler: (action, handler) => handlers.set(action, handler),
  };
  let skips = 0;
  const currentAudio = { paused: false, ended: false, duration: 120, currentTime: 15 };
  createMediaSessionControls({
    session,
    audio: currentAudio,
    getSong: () => ({ id: 'one', title: 'Song one', cover: 'bad-url' }),
    coverUrl: () => 'bad-url',
    Metadata: class {
      constructor() {
        throw new Error('Unsupported');
      }
    },
    play() {},
    pause() {},
    previous() {},
    next: () => skips++,
  });
  assert.equal(session.playbackState, 'playing');
  handlers.get('nexttrack')();
  assert.equal(skips, 1);
});
