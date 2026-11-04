import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  normalizeReferenceUrl,
  ReferenceAudioStore,
} from '../generation/reference-audio-store.mjs';

test('sample links accept individual YouTube videos and reject other destinations', () => {
  const expected = 'https://www.youtube.com/watch?v=BaW_jenozKc';
  for (const url of [
    'https://youtu.be/BaW_jenozKc?t=12',
    expected + '&list=ignored',
    'https://m.youtube.com/shorts/BaW_jenozKc',
  ])
    assert.equal(normalizeReferenceUrl(url), expected);
  assert.equal(normalizeReferenceUrl('  '), '');
  for (const url of [
    'https://127.0.0.1/watch?v=BaW_jenozKc',
    'https://youtube.com.evil.example/watch?v=BaW_jenozKc',
    'file:///private',
    'https://youtube.com/playlist?list=abc',
    'https://user:pass@youtube.com/watch?v=BaW_jenozKc',
  ])
    assert.throws(() => normalizeReferenceUrl(url), /YouTube/);
});

for (const [source, link, canonical] of [
  ['YouTube', 'https://youtu.be/BaW_jenozKc', 'https://www.youtube.com/watch?v=BaW_jenozKc'],
  [
    'Instagram',
    'https://instagram.com/reel/Example_123/?igsh=tracking',
    'https://www.instagram.com/reel/Example_123/',
  ],
])
  test(
    source + ' samples are probed, owned by the song, and reused without downloading again',
    async (t) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'encore-sample-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      const folder = path.join(root, 'songs', 'sample-song', 'work', 'job');
      await mkdir(folder, { recursive: true });
      const song = { id: 'sample-song' };
      const job = { input: { sampleUrl: link } };
      let calls = 0;
      const samples = new ReferenceAudioStore({
        ytDlp: 'configured-downloader',
        cookiesBrowser: 'edge',
        youtubeCookies: fileURLToPath(import.meta.url),
        execute: async (command, args) => {
          calls++;
          assert.equal(command, 'configured-downloader');
          assert.ok(args.includes('--no-playlist'));
          assert.equal(args.includes('--cookies'), source === 'YouTube');
          assert.equal(args.includes('--cookies-from-browser'), source === 'Instagram');
          if (source === 'Instagram')
            assert.equal(args[args.indexOf('--cookies-from-browser') + 1], 'edge');
          assert.equal(args.at(-1), canonical);
          assert.equal(args.includes('--js-runtimes'), source === 'YouTube');
          assert.equal(args.includes('--playlist-items'), source === 'Instagram');
          const file = path.join(folder, 'sample-source.mp3');
          const bytes = Buffer.alloc(44 + 96000);
          bytes.write('RIFF');
          bytes.writeUInt32LE(bytes.length - 8, 4);
          bytes.write('WAVEfmt ', 8);
          bytes.writeUInt32LE(16, 16);
          bytes.writeUInt16LE(1, 20);
          bytes.writeUInt16LE(1, 22);
          bytes.writeUInt32LE(48000, 24);
          bytes.writeUInt32LE(96000, 28);
          bytes.writeUInt16LE(2, 32);
          bytes.writeUInt16LE(16, 34);
          bytes.write('data', 36);
          bytes.writeUInt32LE(96000, 40);
          await writeFile(file, bytes);
          return {
            stdout: JSON.stringify({ id: 'BaW_jenozKc', title: 'Test sample', filepath: file }),
          };
        },
      });
      const context = { root, folder, signal: new AbortController().signal, save: async () => {} };
      const file = await samples.ensure(song, job, context);
      assert.equal(path.dirname(file), path.join(root, 'songs', song.id));
      assert.match(song.sampleFile, /^EncoreSample_sample-song_/);
      assert.equal(song.sampleTitle, 'Test sample');
      assert.equal(song.sampleSourceUrl, canonical);
      assert.equal(song.sampleDuration, 1);
      await access(file);
      await assert.rejects(access(path.join(folder, 'sample-source.mp3')), { code: 'ENOENT' });
      assert.equal(await samples.ensure(song, job, context), file);
      assert.equal(calls, 1);
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        samples.ensure({ id: song.id }, job, { ...context, signal: controller.signal }),
      );
      assert.equal(calls, 1);
    },
  );

for (const [source, link] of [
  ['YouTube', 'https://youtu.be/jNQXAC9IVRw'],
  ['Instagram', 'https://www.instagram.com/p/Example_123/'],
])
  test(source + ' rate limits produce a clear download failure', async () => {
    const samples = new ReferenceAudioStore({
      youtubeCookies: fileURLToPath(import.meta.url),
      execute: async () => {
        throw Object.assign(new Error('Downloader failed'), {
          stderr: 'ERROR: HTTP Error 429: Too Many Requests. Sign in to confirm you are not a bot.',
        });
      },
    });
    await assert.rejects(
      samples.ensure(
        { id: 'sample-song' },
        { input: { sampleUrl: link } },
        {
          root: process.cwd(),
          folder: process.cwd(),
          signal: new AbortController().signal,
          save: async () => {},
        },
      ),
      new RegExp(source + ' blocked this audio download'),
    );
  });

test('a locked browser cookie database gives an actionable error', async () => {
  const samples = new ReferenceAudioStore({
    execute: async () => {
      throw Object.assign(new Error('Downloader failed'), {
        stderr: 'ERROR: Could not copy Chrome cookie database.',
      });
    },
  });
  await assert.rejects(
    samples.ensure(
      { id: 'sample-song' },
      { input: { sampleUrl: 'https://www.instagram.com/p/Example_123/' } },
      { root: process.cwd(), folder: process.cwd(), signal: new AbortController().signal },
    ),
    /Close the configured browser completely/,
  );
});

test('a missing YouTube cookie file is reported before starting the downloader', async () => {
  const samples = new ReferenceAudioStore({
    youtubeCookies: path.join(os.tmpdir(), 'encore-missing-cookies-' + Date.now()),
    execute: async () => {
      throw new Error('The downloader should not start');
    },
  });
  await assert.rejects(
    samples.ensure(
      { id: 'sample-song' },
      { input: { sampleUrl: 'https://youtu.be/jNQXAC9IVRw' } },
      { root: process.cwd(), folder: process.cwd(), signal: new AbortController().signal },
    ),
    /Add the YouTube cookies file/,
  );
});

test('browser cookie decryption failures do not suggest closing the browser', async () => {
  const samples = new ReferenceAudioStore({
    execute: async () => {
      throw Object.assign(new Error('Downloader failed'), {
        stderr: 'ERROR: Failed to decrypt with DPAPI.',
      });
    },
  });
  await assert.rejects(
    samples.ensure(
      { id: 'sample-song' },
      { input: { sampleUrl: 'https://www.instagram.com/p/Example_123/' } },
      { root: process.cwd(), folder: process.cwd(), signal: new AbortController().signal },
    ),
    /could not decrypt the browser cookies/i,
  );
});

test('Instagram links normalize individual reels and posts and reject profiles and unsafe destinations', () => {
  for (const type of ['p', 'reel', 'reels', 'tv']) {
    assert.equal(
      normalizeReferenceUrl('http://instagram.com/' + type + '/Example_123?igsh=tracking#fragment'),
      'https://www.instagram.com/' + (type === 'reels' ? 'reel' : type) + '/Example_123/',
    );
  }
  for (const url of [
    'https://instagram.com/some-profile/',
    'https://instagram.com/stories/some-profile/123/',
    'https://instagram.com.evil.example/reel/Example/',
    'https://user:pass@instagram.com/reel/Example/',
    'https://instagram.com:8443/reel/Example/',
    'https://instagram.com/reel/Example/extra',
    'ftp://instagram.com/reel/Example/',
  ])
    assert.throws(() => normalizeReferenceUrl(url), /Instagram/);
});

test('uploaded audio is converted, readable, and reusable without a download', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'encore-upload-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'songs', 'upload-song');
  await mkdir(folder, { recursive: true });
  const bytes = Buffer.alloc(44 + 96000);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(48000, 24);
  bytes.writeUInt32LE(96000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(96000, 40);
  const song = { id: 'upload-song' };
  const samples = new ReferenceAudioStore({
    execute: async () => {
      throw new Error('Must not download');
    },
  });
  Object.assign(
    song,
    await samples.upload(
      song,
      { name: 'My reference.wav', data: bytes.toString('base64') },
      { root, folder },
    ),
  );
  assert.equal(song.sampleKind, 'upload');
  assert.equal(song.sampleTitle, 'My reference.wav');
  assert.ok(song.sampleDuration > 0);
  const context = { root, folder, signal: new AbortController().signal };
  assert.equal(
    await samples.ensure(song, { input: { sampleUrl: '' } }, context),
    path.join(folder, song.sampleFile),
  );
  await assert.rejects(
    samples.upload(
      song,
      { name: 'broken.wav', data: Buffer.from('not audio').toString('base64') },
      { root, folder },
    ),
    /could not be read/,
  );
  await access(path.join(folder, song.sampleFile));
  await assert.rejects(
    samples.upload(song, { name: 'bad.exe', data: 'AA==' }, { root, folder }),
    /Choose an/,
  );
});
