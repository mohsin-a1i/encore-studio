import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { getMediaArtwork, mediaArtworkSizes } from '../playback/media-artwork.js';
import { getMediaArtworkFile } from '../playback/media-artwork.mjs';

test('native artwork uses sized PNG URLs and preserves the cover version', () => {
  const images = getMediaArtwork(
    'api/cover/song/song-1?v=cover-v2',
    (cover) => `http://localhost:4318/${cover}`,
  );
  assert.equal(images.length, 6);
  for (const [index, image] of images.entries()) {
    const size = mediaArtworkSizes[index];
    const url = new URL(image.src);
    assert.equal(image.type, 'image/png');
    assert.equal(image.sizes, `${size}x${size}`);
    assert.equal(url.pathname, `/api/cover/song/song-1/media/${size}.png`);
    assert.equal(url.searchParams.has('session'), false);
    assert.equal(url.searchParams.get('v'), 'cover-v2');
  }
  assert.deepEqual(
    getMediaArtwork(null, () => ''),
    [],
  );
});

test('SVG and uploaded covers produce cached square PNG artwork owned by the song', async (t) => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'encore-artwork-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const source = path.join(folder, 'cover.svg');
  await writeFile(
    source,
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#ff0000"/></svg>',
  );
  const files = await Promise.all(
    mediaArtworkSizes.map((size) => getMediaArtworkFile(source, folder, size)),
  );
  for (const [index, file] of files.entries()) {
    const metadata = await sharp(file).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, mediaArtworkSizes[index]);
    assert.equal(metadata.height, mediaArtworkSizes[index]);
  }
  const modified = (await stat(files[0])).mtimeMs;
  await getMediaArtworkFile(source, folder, mediaArtworkSizes[0]);
  assert.equal((await stat(files[0])).mtimeMs, modified);
  const manifest = JSON.parse(
    await readFile(path.join(folder, 'media-artwork/source.json'), 'utf8'),
  );
  const uploaded = path.join(folder, 'uploaded.webp');
  await sharp({ create: { width: 20, height: 10, channels: 3, background: '#0000ff' } })
    .webp()
    .toFile(uploaded);
  await getMediaArtworkFile(uploaded, folder, 512);
  const replacement = JSON.parse(
    await readFile(path.join(folder, 'media-artwork/source.json'), 'utf8'),
  );
  assert.notEqual(replacement.sourceHash, manifest.sourceHash);
  const { data } = await sharp(files.at(-1)).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[2] > 240 && data[0] < 15);
  assert.equal((await readdir(path.join(folder, 'media-artwork'))).length, 7);
  await assert.rejects(getMediaArtworkFile(source, folder, 123), /Unsupported/);
});
