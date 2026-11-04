import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:4318';

// Follow the browser's local HTML/CSS/module references to catch broken paths
// after reorganizing files, without requiring an installed test browser.
const checkedAssets = new Set();
async function checkAsset(source, parent = base) {
  const url = new URL(source, parent);
  if (url.origin !== base || checkedAssets.has(url.href)) return;
  checkedAssets.add(url.href);
  const response = await fetch(url);
  assert.equal(response.status, 200, `Missing browser asset: ${url.pathname}`);
  const type = response.headers.get('content-type') || '';
  if (!/html|css|javascript/.test(type)) return;
  const text = await response.text();
  const references = type.includes('html')
    ? [...text.matchAll(/(?:src|href)="([^"#]+)"/g)]
    : type.includes('css')
      ? [...text.matchAll(/@import\s+url\(['"]([^'"]+)['"]\)/g)]
      : [...text.matchAll(/from\s*['"](\.[^'"]+)['"]/g)];
  for (const reference of references) await checkAsset(reference[1], url);
}
await checkAsset('/');
for (const privateFile of [
  '/server/studio-server.mjs',
  '/server/configuration.mjs',
  '/generation/lyrics/song-completion-schema.mjs',
  '/generation/workflows/yue2-song-from-style-and-lyrics.json',
  '/tests/song-service.test.mjs',
  '/tools/check-source.mjs',
]) {
  assert.equal(
    (await fetch(base + privateFile)).status,
    403,
    `Exposed private file: ${privateFile}`,
  );
}
const headers = { 'Content-Type': 'application/json' };
const call = async (route, options = {}) => {
  const r = await fetch(base + '/api/' + route, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  return { status: r.status, data: await r.json() };
};
assert.equal((await fetch(base + '/api/library')).status, 200);
assert.equal(
  (
    await fetch(base + '/api/library', {
      headers: { Host: 'encore.local', Origin: 'https://example.com' },
    })
  ).status,
  200,
);
const { data: library } = await call('library');
assert.ok(Array.isArray(library.songs));
assert.ok(Array.isArray(library.playlists));
const sample = library.songs.find((song) => song.audio);
if (sample) {
  const range = await fetch(base + '/' + sample.audio, {
    headers: { ...headers, Range: 'bytes=0-99' },
  });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(base + '/' + sample.cover, { headers })).status, 200);
}
const created = await call('playlists', {
  method: 'POST',
  body: JSON.stringify({
    name: 'Studio verification',
    description: 'Temporary verification collection',
  }),
});
assert.equal(created.status, 201);
assert.ok(created.data.cover.startsWith('api/cover/'));
assert.equal((await fetch(base + '/' + created.data.cover)).status, 200);
try {
  const songIds = sample ? [sample.id] : [];
  const edited = await call('playlists/' + created.data.id, {
    method: 'PATCH',
    body: JSON.stringify({ songIds }),
  });
  assert.deepEqual(edited.data.songIds, songIds);
} finally {
  await call('playlists/' + created.data.id, { method: 'DELETE' });
}
console.log(
  `Live checks passed: ${checkedAssets.size} browser assets, direct API access, library, audio seeking, covers, and playlist persistence.`,
);
