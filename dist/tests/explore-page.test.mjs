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
const { studioState, findSongById, getPlayableSongs } = await import('../app/browser-state.js');
const { renderExplorePage, refreshExplorePage } = await import('../explore/explore-page.js');
const { openExploreIdeaDialog } = await import('../explore/explore-idea-dialog.js');
const { renderStudioPage } = await import('../studio/studio-page.js');

test('Explore renders accessible decisions, escaped ideas and wrapping genre tags without leaking candidates into the library', () => {
  studioState.songs = [];
  studioState.explore = {
    draft: '</textarea><script>bad()</script>',
    idea: 'Jazz',
    sessionId: 'session',
    songId: 'temporary',
    pending: 0,
  };
  studioState.exploreSongs = [
    {
      id: 'temporary',
      exploreSession: 'session',
      temporary: true,
      title: '<Night>',
      style: 'Jazz',
      lyrics: 'Hello',
      genres: ['Jazz & blues'],
      audio: 'audio/song',
      cover: 'cover/song',
    },
    {
      id: 'next',
      exploreSession: 'session',
      temporary: true,
      audio: 'audio/next',
    },
    {
      id: 'later',
      exploreSession: 'session',
      temporary: true,
      audio: 'audio/later',
    },
    { id: 'reserve', exploreSession: 'session', temporary: true, audio: null },
  ];
  studioState.explore.queueIds = studioState.exploreSongs.map((song) => song.id);
  const html = renderExplorePage();
  assert.match(html, /data-action="explore-save"/);
  assert.match(html, /data-action="explore-idea"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.doesNotMatch(html, /<form|<textarea/);
  assert.match(html, /data-action="explore-skip"/);
  assert.match(html, /tabindex="0"/);
  assert.doesNotMatch(html, /songs ready to swipe ·/);
  assert.match(html, /explore-back-card/);
  assert.doesNotMatch(html, /explore-preparing-card/);
  assert.equal((html.match(/data-deck-key=/g) || []).length, 3);
  assert.match(html, /&lt;Night&gt;/);
  assert.match(html, /Jazz &amp; blues/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(findSongById('temporary').id, 'temporary');
  assert.deepEqual(getPlayableSongs(), []);
  assert.doesNotMatch(renderStudioPage(), /data-id="temporary"/);
});

test('the idea dialog restores and escapes the draft with submit and cancel controls', () => {
  studioState.exploreDraft = '</textarea><script>bad()</script>';
  openExploreIdeaDialog();
  const html = modalRoot.innerHTML;
  assert.match(html, /role="dialog"/);
  assert.match(html, /id="explore-form"/);
  assert.match(html, /id="explore-idea"/);
  assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /type="submit"/);
  assert.match(html, /data-action="close-modal">\s*Cancel/);
  assert.equal(studioState.modal.kind, 'explore-idea');
});

test('the deck never exceeds three cards including loading across all buffer sizes', () => {
  for (let count = 0; count <= 6; count++) {
    studioState.explore = {
      idea: 'Jazz',
      sessionId: 'limit',
      pending: 1,
      queueIds: Array.from({ length: count }, (_, i) => `ready-${i}`),
    };
    studioState.exploreSongs = studioState.explore.queueIds.map((id) => ({
      id,
      audio: `${id}.mp3`,
    }));
    const html = renderExplorePage();
    assert.equal((html.match(/data-deck-key=/g) || []).length, Math.min(3, count + 1));
    assert.equal(html.includes('explore-preparing-card'), count < 3);
  }
});

test('an exhausted deck shows only the generation card until another song is ready', () => {
  studioState.explore = {
    draft: 'Jazz',
    idea: 'Jazz',
    sessionId: 'session',
    songId: null,
    pending: 1,
  };
  studioState.exploreSongs = [{ id: 'pending', exploreSession: 'session', audio: null }];
  studioState.explore.queueIds = studioState.exploreSongs.map((song) => song.id);
  const html = renderExplorePage();
  assert.match(html, /explore-preparing-empty/);
  assert.match(html, /A little magic, taking shape/);
  assert.match(html, /Your next sound is queued and taking shape/);
  assert.doesNotMatch(
    html,
    /data-explore-card|explore-back-card|data-action="explore-skip"|data-action="explore-save"/,
  );
});

test('the Explore card renders its own play or pause state', () => {
  studioState.explore = {
    draft: 'Jazz',
    idea: 'Jazz',
    sessionId: 's',
    songId: 'explore',
    pending: 0,
  };
  studioState.exploreSongs = [{ id: 'explore', exploreSession: 's', audio: 'api/audio/explore' }];
  studioState.currentId = 'explore';
  studioState.playing = true;
  studioState.explore.queueIds = studioState.exploreSongs.map((song) => song.id);
  let html = renderExplorePage();
  assert.match(html, /data-song-play\s+aria-pressed="true"\s+data-action="play"/);
  assert.match(html, /<span>Pause<\/span>/);
  studioState.playing = false;
  html = renderExplorePage();
  assert.match(html, /data-song-play\s+aria-pressed="false"/);
  assert.match(html, /<span>Play song<\/span>/);
  studioState.currentId = 'another-song';
  studioState.playing = true;
  assert.match(renderExplorePage(), /data-song-play\s+aria-pressed="false"/);
});

test('unchanged polling preserves inspectable DOM despite browser HTML normalization', (t) => {
  studioState.explore = {
    draft: 'Jazz',
    idea: 'Jazz',
    sessionId: 's',
    songId: 'explore',
    pending: 0,
  };
  studioState.exploreSongs = [
    {
      id: 'explore',
      title: 'Original',
      exploreSession: 's',
      audio: 'api/audio/explore',
    },
  ];
  studioState.explore.queueIds = studioState.exploreSongs.map((song) => song.id);
  renderExplorePage();
  let replacements = 0;
  const results = {
    get innerHTML() {
      return 'Browser-normalized HTML with updated animation attributes';
    },
    set innerHTML(value) {
      replacements++;
    },
    querySelector: () => null,
    contains: () => false,
    querySelectorAll: () => [],
  };
  const previousQuery = document.querySelector;
  document.querySelector = (selector) => (selector === '#explore-results' ? results : null);
  t.after(() => {
    document.querySelector = previousQuery;
  });
  refreshExplorePage();
  refreshExplorePage();
  refreshExplorePage();
  assert.equal(replacements, 0);
  studioState.exploreSongs[0].title = 'Changed';
  refreshExplorePage();
  assert.equal(replacements, 1);
  refreshExplorePage();
  assert.equal(replacements, 1);
});
