import test from 'node:test';
import assert from 'node:assert/strict';

const modalRoot = { innerHTML: '', querySelector: () => null };
globalThis.document = {
  querySelector: (selector) => (selector === '#modal-root' ? modalRoot : {}),
  body: { style: {} },
};
globalThis.sessionStorage = { getItem: () => null };
globalThis.localStorage = { getItem: () => null };
globalThis.location = {
  hostname: 'localhost',
  origin: 'http://localhost:4318',
  href: 'http://localhost:4318/',
};
const { studioState } = await import('../app/browser-state.js');
const { createStudioConnection } = await import('../app/studio-connection.js');
const { allServicesConnected, getServiceStatus } = await import('../settings/connection-status.js');
const { renderApplicationShell } = await import('../app/shell-view.js');
const { renderSettingsPage, refreshSettingsPage } = await import('../settings/settings-page.js');

function reset() {
  Object.assign(studioState, {
    profileId: 'guest',
    connected: true,
    health: { codex: true, comfy: true },
    songs: [],
    playlists: [],
    view: 'home',
  });
  studioState.connectionChecks.clear();
}
const response = (data) => ({ ok: true, json: async () => data });

test('a failed Explore request verifies Studio and forces fresh dependency checks for the shared status', async (t) => {
  reset();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const route = new URL(url).pathname.slice(5);
    calls.push(route);
    if (route === 'explore/start') throw new TypeError('fetch failed');
    if (route === 'health/studio') return response({ connected: true });
    return response(route === 'health/comfy' ? { comfy: false } : { codex: true });
  });
  const client = createStudioConnection({ syncPlaybackWithLibrary() {} });
  await assert.rejects(
    client.requestStudio('explore/start', { method: 'POST', body: '{}' }),
    /fetch failed/,
  );
  await new Promise(setImmediate);
  assert.deepEqual(
    calls.sort(),
    ['explore/start', 'health/codex', 'health/comfy', 'health/studio'].sort(),
  );
  assert.equal(studioState.connected, true);
  assert.equal(studioState.health.comfy, false);
  assert.equal(allServicesConnected(), false);
});

test('background Explore errors recheck dependencies once and a lost Studio updates its own status', async (t) => {
  reset();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const route = new URL(url).pathname.slice(5);
    calls.push(route);
    if (route === 'library')
      return response({
        songs: [],
        exploreSongs: [],
        playlists: [],
        explore: { sessionId: 'failed-session', error: 'fetch failed' },
      });
    throw new TypeError('fetch failed');
  });
  const client = createStudioConnection({ syncPlaybackWithLibrary() {} });
  await client.refreshLibrary();
  await new Promise(setImmediate);
  assert.equal(studioState.connected, false);
  await client.refreshLibrary();
  await new Promise(setImmediate);
  assert.equal(calls.filter((route) => route === 'health/studio').length, 1);
});

test('an Explore audio failure shows ComfyUI status immediately and stale or unrelated health responses cannot clear it', async (t) => {
  reset();
  studioState.view = 'explore';
  const previous = globalThis.EventSource;
  globalThis.EventSource = undefined;
  t.after(() => {
    globalThis.EventSource = previous;
  });
  let finishOldCheck;
  let recovered = false;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const route = new URL(url).pathname.slice(5);
    calls.push(route);
    if (route === 'health')
      return new Promise((resolve) => {
        finishOldCheck = resolve;
      });
    if (route === 'library')
      return response({
        songs: [],
        playlists: [],
        exploreSongs: [
          { id: 'failed-audio', error: 'fetch failed', job: { id: 'job', kind: 'audio' } },
        ],
        explore: { sessionId: 'audio-session', error: 'fetch failed', queueIds: ['failed-audio'] },
      });
    return response({
      connected: true,
      codex: true,
      comfy: route === 'health/comfy' ? recovered : true,
    });
  });
  const visible = [];
  const client = createStudioConnection({ syncPlaybackWithLibrary() {} });
  const stop = client.startUpdates(() => visible.push(renderApplicationShell()));
  t.after(stop);
  const oldCheck = client.refreshDependencyStatus();
  await client.refreshLibrary();
  await new Promise(setImmediate);
  assert.equal(studioState.health.comfy, false);
  assert.equal(calls.includes('health/codex'), false);
  assert.ok(visible.some((html) => html.includes('offline-note') && html.includes('ComfyUI')));
  finishOldCheck(response({ codex: true, comfy: true }));
  await oldCheck;
  assert.equal(studioState.health.comfy, false);
  await client.refreshDependencyStatus('codex');
  assert.equal(studioState.health.comfy, false);
  recovered = true;
  await client.retryServiceConnection('comfy');
  assert.equal(studioState.health.comfy, true);
  assert.equal(allServicesConnected(), true);
});

test('push events update the library without fetching and disconnect cleanly', async (t) => {
  reset();
  const previous = globalThis.EventSource;
  const streams = [];
  globalThis.EventSource = class {
    handlers = new Map();
    constructor(url) {
      this.url = url;
      streams.push(this);
    }
    addEventListener(name, handler) {
      this.handlers.set(name, handler);
    }
    close() {
      this.closed = true;
    }
  };
  t.after(() => {
    globalThis.EventSource = previous;
  });
  let updates = 0,
    syncs = 0;
  const client = createStudioConnection({ syncPlaybackWithLibrary: () => syncs++ });
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected polling request');
  });
  const stop = client.startUpdates(() => updates++);
  assert.match(streams[0].url, /api\/events\?profile=guest/);
  streams[0].handlers.get('message')({
    data: JSON.stringify({
      profile: { id: 'guest' },
      profiles: [],
      songs: [],
      exploreSongs: [{ id: 'new-candidate' }],
      playlists: [],
    }),
  });
  assert.equal(studioState.exploreSongs[0].id, 'new-candidate');
  assert.equal(syncs, 1);
  assert.equal(updates, 1);
  streams[0].handlers.get('error')();
  assert.equal(studioState.connected, false);
  stop();
  assert.equal(streams[0].closed, true);
  const stoppedUpdates = updates;
  streams[0].handlers.get('error')();
  assert.equal(updates, stoppedUpdates);
});

test('a delayed library response cannot overwrite a newer pushed snapshot', async (t) => {
  reset();
  const previous = globalThis.EventSource;
  let receive;
  globalThis.EventSource = class {
    addEventListener(name, handler) {
      if (name === 'message') receive = handler;
    }
    close() {}
  };
  const client = createStudioConnection({ syncPlaybackWithLibrary: () => {} });
  const stop = client.startUpdates(() => {});
  t.after(() => {
    stop();
    globalThis.EventSource = previous;
  });
  let finish;
  t.mock.method(
    globalThis,
    'fetch',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const refresh = client.refreshLibrary();
  receive({
    data: JSON.stringify({
      profile: { id: 'guest' },
      profiles: [],
      songs: [],
      exploreSongs: [{ id: 'latest' }],
      playlists: [],
    }),
  });
  finish(response({ songs: [], exploreSongs: [], playlists: [] }));
  assert.equal(await refresh, true);
  assert.equal(studioState.exploreSongs[0].id, 'latest');
});

test('Studio connects with one library request and no authentication handshake', async (t) => {
  reset();
  studioState.connected = false;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, undefined);
    return response({ songs: [], playlists: [] });
  });
  const client = createStudioConnection({ syncPlaybackWithLibrary: () => {} });
  assert.equal(await client.retryServiceConnection('studio'), true);
  assert.deepEqual(
    calls.map((url) => new URL(url).pathname),
    ['/api/library'],
  );
});

test('media URLs keep versions without session parameters', async () => {
  const { mediaUrl } = await import('../app/interface-helpers.js');
  assert.equal(
    mediaUrl('api/audio/song?v=take-2'),
    'http://localhost:4318/api/audio/song?v=take-2',
  );
  assert.equal(mediaUrl('api/cover/song'), 'http://localhost:4318/api/cover/song');
});

test('a response from the previous profile cannot replace the current collection', async (t) => {
  reset();
  let finishRequest;
  const data = new Promise((resolve) => {
    finishRequest = resolve;
  });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.headers['X-Profile-Id'], 'guest');
    return response(await data);
  });
  const client = createStudioConnection({ syncPlaybackWithLibrary: () => {} });
  const pending = client.refreshLibrary();
  studioState.profileId = 'new-profile';
  studioState.songs = [];
  finishRequest({ songs: [{ id: 'guest-song' }], playlists: [] });
  assert.equal(await pending, false);
  assert.deepEqual(studioState.songs, []);
});

test('failed library connections return offline and a later retry reconnects directly', async (t) => {
  reset();
  let available = false;
  t.mock.method(globalThis, 'fetch', async () => {
    if (!available) throw new Error('Studio unavailable');
    return response({ songs: [], playlists: [] });
  });
  const client = createStudioConnection({ syncPlaybackWithLibrary: () => {} });
  assert.equal(await client.connectStudio(), false);
  assert.equal(studioState.connected, false);
  available = true;
  assert.equal(await client.connectStudio(), true);
  assert.equal(studioState.connected, true);
});

test('each dependency retry uses its own fresh endpoint and preserves the other service', async (t) => {
  reset();
  const calls = [];
  let codex = false;
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(new URL(url).pathname);
    if (url.endsWith('/codex')) return response({ codex });
    throw new Error('ComfyUI check unavailable');
  });
  const client = createStudioConnection({ syncPlaybackWithLibrary: () => {} });
  assert.equal(await client.retryServiceConnection('codex'), false);
  assert.equal(studioState.health.comfy, true);
  codex = true;
  assert.equal(await client.retryServiceConnection('codex'), true);
  assert.equal(await client.retryServiceConnection('comfy'), false);
  assert.equal(studioState.health.codex, true);
  assert.equal(studioState.connected, true);
  assert.deepEqual(calls, ['/api/health/codex', '/api/health/codex', '/api/health/comfy']);
});

test('the offline note tracks missing services and it and navigation open Settings', () => {
  reset();
  assert.equal(allServicesConnected(), true);
  assert.equal(renderApplicationShell().includes('offline-note'), false);
  assert.equal((renderApplicationShell().match(/data-view="settings"/g) || []).length, 1);
  for (const id of ['studio', 'codex', 'comfy']) {
    reset();
    if (id === 'studio') studioState.connected = false;
    else studioState.health[id] = false;
    assert.equal(allServicesConnected(), false);
    const html = renderApplicationShell();
    assert.match(html, /<button class="offline-note" data-action="nav" data-view="settings">/);
    assert.equal((html.match(/data-view="settings"/g) || []).length, 2);
    assert.equal(getServiceStatus(id), 'Not connected');
  }
  studioState.connectionChecks.add('comfy');
  assert.equal(getServiceStatus('comfy'), 'Checking…');
});

test('Settings is a full page with three service cards and independent check buttons', () => {
  reset();
  studioState.view = 'settings';
  const html = renderApplicationShell();
  assert.match(html, /<h1 id="settings-title" tabindex="-1">Settings<\/h1>/);
  assert.equal((html.match(/data-connection-service=/g) || []).length, 3);
  assert.equal((html.match(/data-action="retry-connection"/g) || []).length, 3);
  for (const id of ['studio', 'codex', 'comfy'])
    assert.match(html, new RegExp('data-service="' + id + '"'));
  assert.match(html, /data-connected-count>\s*3\s*<\/span>/);
  assert.match(html, /id="connections-heading">Connections<\/h2>/);
  assert.doesNotMatch(html, /aria-modal|Open local studio|offline-note/);
  assert.equal((html.match(/name="studio-theme"/g) || []).length, 7);
  assert.match(html, /value="magic"/);
  assert.match(html, /Appearance/);
  studioState.health.codex = false;
  let page = renderSettingsPage();
  assert.doesNotMatch(page, /data-connection-help|Sign in to Codex|Start ComfyUI/);
  assert.match(page, /Retry Codex connection/);
  studioState.connectionChecks.add('codex');
  page = renderSettingsPage();
  assert.match(page, /aria-disabled="true"\s+aria-busy="true"/);
  assert.match(page, /Checking…/);
});

test('status refresh updates existing cards and buttons without replacing them', () => {
  reset();
  const nodes = new Map();
  const node = (key) => {
    if (!nodes.has(key))
      nodes.set(key, {
        dataset: {},
        attributes: {},
        textContent: '',
        hidden: false,
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        querySelector(selector) {
          return node(key + selector);
        },
        classList: { toggle() {} },
      });
    return nodes.get(key);
  };
  const originalQuery = document.querySelector;
  document.querySelector = (selector) => node(selector);
  try {
    const button = node(
      '#settings-page[data-connection-service="codex"][data-action="retry-connection"]',
    );
    studioState.connectionChecks.add('codex');
    refreshSettingsPage();
    assert.equal(button.attributes['aria-busy'], 'true');
    assert.equal(button.querySelector('[data-check-label]').textContent, 'Checking…');
    studioState.connectionChecks.clear();
    studioState.health.codex = false;
    refreshSettingsPage();
    assert.equal(button.attributes['aria-busy'], 'false');
    assert.equal(button.querySelector('[data-check-label]').textContent, 'Retry');
    assert.equal(node('#settings-page[data-connected-count]').textContent, 2);
    assert.equal('innerHTML' in button, false);
  } finally {
    document.querySelector = originalQuery;
  }
});

test('an acknowledged write prevents an older HTTP snapshot from reverting profile state', async (t) => {
  reset();
  studioState.profile = { id: 'guest' };
  studioState.songs = [{ id: 'saved', lyrics: 'New words' }];
  const client = createStudioConnection({ syncPlaybackWithLibrary() {} });
  let finish;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (options.method === 'PATCH')
      return { ok: true, headers: { get: () => '12' }, json: async () => ({ id: 'saved' }) };
    return new Promise((resolve) => (finish = resolve));
  });
  const pending = client.refreshLibrary();
  await client.requestStudio('songs/saved', { method: 'PATCH', body: '{}' });
  finish(
    response({
      revision: 10,
      profile: { id: 'guest' },
      songs: [],
      playlists: [],
      exploreSongs: [],
    }),
  );
  await pending;
  assert.equal(studioState.songs[0].id, 'saved');
});
