import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createCoverArtwork, coverPaletteIds } from '../library/cover-artwork.mjs';
import { themes } from '../settings/theme-palettes.js';
import { dominantCoverHue } from '../settings/cover-palette.js';
import { regenerateCovers } from '../tools/regenerate-covers.mjs';

test('every Encore theme has deterministic, renderable cover art', async () => {
  assert.deepEqual(
    coverPaletteIds,
    themes.map((theme) => theme.id),
  );
  const images = new Set();
  for (const paletteId of coverPaletteIds) {
    const options = { id: 'test', title: '<script> & Song', paletteId };
    const svg = createCoverArtwork(options);
    assert.equal(svg, createCoverArtwork(options));
    assert.ok(svg.includes('&lt;script&gt; &amp; Song'));
    const output = await sharp(Buffer.from(svg)).resize(64, 64).png().toBuffer();
    const pixels = await sharp(output).ensureAlpha().raw().toBuffer();
    const hue = dominantCoverHue(pixels);
    const theme = themes.find((item) => item.id === paletteId);
    if (theme.saturation === 0) assert.equal(hue, null);
    else if (paletteId !== 'magic') {
      const distance = Math.abs(hue - theme.hue);
      assert.ok(Math.min(distance, 360 - distance) < 20, `${paletteId} hue: ${hue}`);
    }
    images.add(output.toString('base64'));
  }
  assert.equal(images.size, themes.length);
});

test('replacing all covers preserves music and backs up original artwork and metadata', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'encore-covers-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, 'data'),
    backupRoot = path.join(root, 'backup');
  await mkdir(path.join(dataRoot, 'songs'), { recursive: true });
  await writeFile(
    path.join(dataRoot, 'library.json'),
    JSON.stringify({
      profiles: [{ id: 'one' }],
      playlists: [{ id: 'mix', name: 'Mix', songIds: ['song-0'] }],
    }),
  );
  for (let index = 0; index < 7; index++) {
    const folder = path.join(dataRoot, 'songs', `song-${index}`);
    await mkdir(folder);
    await writeFile(
      path.join(folder, 'song.json'),
      JSON.stringify({
        id: `song-${index}`,
        title: 'Song',
        lyrics: 'Keep my lyrics',
        audioFile: 'audio.mp3',
        coverFile: 'cover.svg',
      }),
    );
    await writeFile(path.join(folder, 'cover.svg'), 'original artwork');
    await writeFile(path.join(folder, 'audio.mp3'), 'original audio');
  }
  const result = await regenerateCovers({ dataRoot, backupRoot });
  assert.equal(result.songs, 7);
  assert.equal(result.playlists, 1);
  assert.equal(Object.keys(result.palettes).length, themes.length);
  const folder = path.join(dataRoot, 'songs', 'song-0');
  const song = JSON.parse(await readFile(path.join(folder, 'song.json'), 'utf8'));
  assert.equal(song.lyrics, 'Keep my lyrics');
  assert.equal(song.audioFile, 'audio.mp3');
  assert.ok(song.coverVersion);
  assert.equal(await readFile(path.join(folder, 'audio.mp3'), 'utf8'), 'original audio');
  assert.equal(
    await readFile(path.join(backupRoot, 'songs', 'song-0', 'cover.svg'), 'utf8'),
    'original artwork',
  );
});
