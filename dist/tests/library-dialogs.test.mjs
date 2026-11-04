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
const {
  openSongDetails,
  openPlaylistSelection,
  openPlaylistEditor,
  confirmSongDeletion,
  renderLyricsSections,
} = await import('../library/library-dialogs.js');

function reset() {
  studioState.songs = [
    {
      id: 'song-1',
      title: 'First <song>',
      lyrics: '[Verse]\nHello',
      status: 'ready',
      audio: 'song.mp3',
    },
  ];
  studioState.playlists = [
    { id: 'p1', name: 'Night & Day', songIds: ['song-1'] },
    { id: 'p2', name: 'Favorites', songIds: ['song-1', 'other-song'] },
    { id: 'p3', name: 'Unrelated', songIds: [] },
  ];
  studioState.view = 'library';
  studioState.playlistId = null;
}

test('song details show all memberships with individual accessible remove controls', () => {
  reset();
  openSongDetails('song-1');
  const html = modalRoot.innerHTML;
  assert.match(html, /data-action="add-to-playlist"/);
  assert.match(html, /aria-label="Remove from Night &amp; Day"/);
  assert.match(html, /aria-label="Remove from Favorites"/);
  assert.equal((html.match(/data-action="remove-song-from-playlist"/g) || []).length, 2);
  assert.doesNotMatch(html, /Unrelated|Remove from playlist/);
  assert.match(html, /First &lt;song&gt;/);
  assert.equal((html.match(/id="modal-title"/g) || []).length, 1);
  assert.match(html, /aria-labelledby="modal-title"/);
  assert.match(html, /aria-label="Download song"/);
  assert.match(html, /<header class="song-identity"[^>]*>/);
  assert.doesNotMatch(html, /song-cover-control|song-cover-placeholder/);
  assert.doesNotMatch(html, /song-header-meta/);
  assert.doesNotMatch(html, /data-action="copy-song"/);
  assert.match(html, /data-action="edit-song"/);
  assert.match(
    html,
    /<button\s+type="button"\s+class="button secondary song-download-button"[\s\S]*?data-action="download-song"/,
  );
  assert.doesNotMatch(html, /<a\b/);
  assert.match(html, /class="song-detail-sidebar"/);
});

test('a song without a title or metadata keeps an accessible dialog name without placeholders', () => {
  reset();
  studioState.songs[0].title = '';
  openSongDetails('song-1');
  const html = modalRoot.innerHTML;
  assert.match(html, /id="modal-title" hidden>Song details/);
  assert.doesNotMatch(html, /song-title-field|song-header-meta|song-header-placeholder/);
});

test('the card-style song summary preserves artwork, metadata and all detail actions', () => {
  reset();
  Object.assign(studioState.songs[0], {
    cover: 'cover.jpg',
    genres: ['Indie pop', 'Soul'],
    duration: 125,
    style: 'Warm keys & <soft> percussion',
  });
  studioState.currentId = 'song-1';
  studioState.playing = true;
  openSongDetails('song-1');
  const html = modalRoot.innerHTML;
  assert.match(html, /class="song-detail-main">\s*<header class="song-identity"/);
  assert.match(html, /Warm keys &amp; &lt;soft&gt; percussion/);
  assert.equal((html.match(/Musical style description/g) || []).length, 1);
  assert.match(html, /Indie pop/);
  assert.match(html, /Soul/);
  assert.match(html, /2:05/);
  assert.match(html, /aria-pressed="true"/);
  for (const action of [
    'upload-cover',
    'play',
    'download-song',
    'share-song',
    'edit-song',
    'copy-lyrics',
    'add-to-playlist',
    'remove-song-from-playlist',
    'delete-song',
    'close-modal',
  ]) {
    assert.ok(html.includes(`data-action="${action}"`), `${action} remains available`);
  }
  assert.match(html, /Hello/);
  studioState.currentId = null;
  studioState.playing = false;
});

test('song with no memberships has a clear empty state and Manage control', () => {
  reset();
  studioState.playlists = [];
  openSongDetails('song-1');
  assert.match(modalRoot.innerHTML, /Not in a playlist yet/);
  assert.match(modalRoot.innerHTML, /Manage/);
  assert.doesNotMatch(modalRoot.innerHTML, /data-action="remove-song-from-playlist"/);
});

test('playlist manager supports adding and removing memberships and creating a playlist', () => {
  reset();
  openPlaylistSelection('add-to-playlist', 'song-1');
  const html = modalRoot.innerHTML;
  assert.equal((html.match(/data-playlist-membership/g) || []).length, 3);
  assert.equal((html.match(/\schecked\s/g) || []).length, 2);
  assert.match(html, /data-action="new-playlist"/);
  assert.doesNotMatch(html, /Changes save automatically/);
  assert.match(html, /data-action="song"/);
  assert.doesNotMatch(html, /id="selection-form"/);
  assert.deepEqual(studioState.modal, {
    kind: 'add-to-playlist',
    id: 'song-1',
  });
});

test('creating a playlist from the manager retains the song and provides a return control', () => {
  reset();
  openPlaylistEditor(false, 'song-1');
  assert.equal(studioState.modal.songId, 'song-1');
  assert.match(modalRoot.innerHTML, /data-action="add-to-playlist" data-id="song-1">Back/);
  assert.match(modalRoot.innerHTML, /<header class="modal-head">/);
  assert.match(
    modalRoot.innerHTML,
    /<div class="modal-body">[\s\S]*?<form\b[^>]*id="playlist-form"[^>]*>[\s\S]*?class="modal-footer"[\s\S]*?Create playlist[\s\S]*?<\/form>/,
  );
});

test('confirmation dialogs retain their shared header, content, and footer actions', () => {
  reset();
  confirmSongDeletion('song-1');
  assert.match(modalRoot.innerHTML, /<header class="modal-head">/);
  assert.match(
    modalRoot.innerHTML,
    /<div class="modal-body">[\s\S]*?This cannot be undone\.[\s\S]*?<footer class="modal-footer">/,
  );
  assert.match(modalRoot.innerHTML, /data-action="confirm-delete-song"/);
});

test('lyrics start directly with the first tag and preserve verse line breaks', () => {
  const html = renderLyricsSections('  \n[Verse]\nA line\n\n[Chorus]\nAnother line\n ');
  assert.equal(
    html,
    '<div class="lyrics" dir="auto"><span class="section-tag section-tag-first">Verse</span>\nA line\n\n<span class="section-tag">Chorus</span>\nAnother line</div>',
  );
  assert.match(
    renderLyricsSections('<script> & [<Verse>]'),
    /&lt;script&gt; &amp; <span class="section-tag">&lt;Verse&gt;<\/span>/,
  );
  const empty = renderLyricsSections(' ');
  assert.match(empty, /class="empty-state"/);
  assert.match(empty, />No lyrics<\/h3>/);
  assert.match(empty, /An instrumental story\./);
});
