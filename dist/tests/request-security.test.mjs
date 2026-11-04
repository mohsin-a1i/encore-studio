import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePlaylistInput,
  requireSafeId,
  isPublicAssetPath,
} from '../server/request-security.mjs';
import { createRequestId } from '../app/request-id.js';
import { getNetBirdAddresses } from '../server/netbird-addresses.mjs';
import { createCoverArtwork } from '../library/cover-artwork.mjs';

test('only browser assets can be served from the shared dist tree', () => {
  for (const filename of [
    'index.html',
    'favicon.svg',
    'app/browser-app.js',
    'studio/studio.css',
    'library/library-page.js',
  ])
    assert.equal(isPublicAssetPath(filename), true, filename);
  for (const filename of [
    'server/studio-server.mjs',
    'server/anything.js',
    'generation/lyrics/song-completion-schema.mjs',
    'generation/workflows/yue2-song-from-style-and-lyrics.json',
    'tools/check-source.mjs',
    'tests/fixtures/comfy-nodes.json',
    'app/.private.js',
    'package.json',
  ])
    assert.equal(isPublicAssetPath(filename), false, filename);
});

test('NetBird listeners bind only the active WireGuard tunnel address', () => {
  assert.deepEqual(
    getNetBirdAddresses({
      wt0: [
        { family: 'IPv4', address: '100.72.1.191', internal: false },
        { family: 'IPv6', address: 'fda8:e5e0::191', internal: false },
        { family: 'IPv4', address: '127.0.0.1', internal: true },
      ],
      Ethernet: [{ family: 'IPv4', address: '100.72.2.2', internal: false }],
    }),
    ['100.72.1.191', 'fda8:e5e0::191'],
  );
  assert.deepEqual(
    getNetBirdAddresses({ wt0: [{ family: 'IPv4', address: '192.168.1.2', internal: false }] }),
    [],
  );
});
test('request IDs also work on HTTP without randomUUID', () => {
  const provider = {
    getRandomValues: (bytes) => {
      bytes.fill(23);
      return bytes;
    },
  };
  assert.match(
    createRequestId(provider),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});
test('IDs, playlists, and SVG text retain their safety checks', () => {
  assert.throws(() => requireSafeId('../song'), /Invalid/);
  assert.throws(() => normalizePlaylistInput({ name: '' }), /name/);
  assert.equal(normalizePlaylistInput({ name: ' A playlist ' }).name, 'A playlist');
  const cover = createCoverArtwork({ id: 'one', title: '<script>oops</script>', seed: 'one' });
  assert.equal(cover.includes('<script>'), false);
});
