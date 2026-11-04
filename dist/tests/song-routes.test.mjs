import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openLibraryStore } from '../library/library-store.mjs';
import { SongService } from '../songs/song-service.mjs';
import { getSongFilePath, getSongDirectory } from '../songs/song-record.mjs';
import { songRoutes } from '../songs/song-routes.mjs';
import { libraryRoutes } from '../library/library-routes.mjs';
import { mediaRoutes } from '../songs/media-routes.mjs';
import { sendJsonResponse } from '../server/http-responses.mjs';
import sharp from 'sharp';

test('song, library, playlist, artwork, and media APIs share the same durable entity', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'encore-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await openLibraryStore(root);
  const renderer = {
    stop: async () => {},
    executeGeneration: async (song, job, { update }) => {
      song.audioFile = 'play.mp3';
      song.masterFile = 'master.flac';
      song.audioVersion = job.id;
      await writeFile(getSongFilePath(root, song, song.audioFile), Buffer.alloc(256, 5));
      await writeFile(getSongFilePath(root, song, song.masterFile), 'master');
      await update('ready');
    },
  };
  const songs = new SongService({
    store,
    renderer,
    writeLyrics: async () => ({
      title: 'Hello',
      style: 'Urdu pop',
      lyrics: 'لکڑ، لکڑہارا',
      genres: ['Pop'],
    }),
    writeMetadata: async () => ({ title: 'Hello', genres: ['Pop'] }),
  });
  const idle = async () => {
    while (songs.generationPromise) await songs.generationPromise;
  };
  t.after(idle);
  let codexAvailable = true;
  const server = http.createServer(async (request, response) => {
    const routeSegments = new URL(request.url, 'http://studio').pathname.split('/').filter(Boolean);
    const context = {
      request,
      response,
      routeSegments,
      store,
      songs,
      dataRoot: root,
      health: async () => ({
        codex: codexAvailable,
        comfy: true,
        workflow: true,
        coverWorkflow: true,
        ytDlp: true,
      }),
    };
    try {
      const route =
        routeSegments[1] === 'songs'
          ? songRoutes
          : ['library', 'playlists'].includes(routeSegments[1])
            ? libraryRoutes
            : mediaRoutes;
      await route(context);
    } catch (error) {
      sendJsonResponse(response, error.status || 500, { error: error.message });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  const call = async (route, method = 'GET', input) => {
    if (
      input &&
      /^songs\/[^/]+(?:\/(audio|lyrics))?$/.test(route) &&
      ['PATCH', 'POST'].includes(method)
    )
      input = {
        baseRevision: songs.get(route.split('/')[1]).editRevision || 0,
        ...input,
      };
    const response = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: input && JSON.stringify(input),
    });
    return { status: response.status, data: await response.json() };
  };
  const created = await call('songs', 'POST', { idea: 'A lucky fool' });
  assert.equal(created.status, 202);
  const id = created.data.id;
  await idle();
  let library = (await call('library')).data;
  assert.equal(library.songs[0].id, id);
  assert.equal(library.songs[0].audio, null);
  assert.equal('jobs' in library, false);
  assert.equal('drafts' in library, false);
  const saved = await call('songs/' + id, 'PATCH', {
    idea: 'A luckier fool',
    title: 'Faran',
    style: 'Comedy rap',
    lyrics: 'My exact words',
  });
  assert.equal(saved.data.title, 'Faran');
  assert.equal(saved.data.style, 'Comedy rap');
  assert.equal(saved.data.lyrics, 'My exact words');
  assert.equal(saved.data.idea, 'A lucky fool');
  codexAvailable = false;
  await call('songs/' + id + '/audio', 'POST', {
    idea: 'Do not save this idea',
    title: 'Faran',
    style: 'Comedy rap',
    lyrics: 'My exact words',
  });
  await idle();
  library = (await call('library')).data;
  assert.equal(library.songs.length, 1);
  assert.equal(library.songs[0].status, 'ready');
  assert.ok(library.songs[0].audio);
  assert.equal(library.songs[0].idea, 'A lucky fool');
  assert.equal(library.songs[0].style, 'Comedy rap');
  assert.equal(library.songs[0].lyrics, 'My exact words');
  const unavailableDraft = await call('songs/' + id + '/lyrics', 'POST', {
    idea: 'An idea that requires Codex',
  });
  assert.equal(unavailableDraft.status, 503);
  assert.match(unavailableDraft.data.error, /Codex is unavailable/);
  codexAvailable = true;
  assert.equal('audioFile' in library.songs[0], false);
  assert.equal('input' in library.songs[0].job, false);
  const previousAudio = library.songs[0].audio;
  const rejectedAudio = await call('songs/' + id + '/audio', 'POST', {
    style: '   ',
    lyrics: '   ',
  });
  assert.equal(rejectedAudio.status, 400);
  library = (await call('library')).data;
  assert.equal(library.songs[0].status, 'ready');
  assert.equal(library.songs[0].audio, previousAudio);
  const range = await fetch(new URL('../' + library.songs[0].audio, base), {
    headers: { Range: 'bytes=0-9' },
  });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 10);
  const generatedArtwork = await fetch(base + 'cover/song/' + id + '/media/512.png');
  assert.equal(generatedArtwork.status, 200);
  assert.match(generatedArtwork.headers.get('content-type'), /image\/png/);
  assert.equal(
    (await sharp(Buffer.from(await generatedArtwork.arrayBuffer())).metadata()).width,
    512,
  );
  const image =
    'data:image/png;base64,' +
    (
      await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#112233' },
      })
        .png()
        .toBuffer()
    ).toString('base64');
  assert.equal((await call('cover/song/' + id, 'POST', { image })).status, 200);
  assert.equal((await fetch(base + 'cover/song/' + id)).status, 200);
  const nativeArtwork = await fetch(base + 'cover/song/' + id + '/media/192.png', {
    method: 'HEAD',
  });
  assert.equal(nativeArtwork.status, 200);
  assert.equal(Number(nativeArtwork.headers.get('content-length')) > 0, true);
  assert.equal((await fetch(base + 'cover/song/' + id + '/media/999.png')).status, 404);
  const draft = await call('songs', 'POST', {
    kind: 'draft',
    style: 'Soft folk',
    lyrics: '[Verse]\nNew words',
  });
  assert.equal(draft.status, 201);
  assert.equal(draft.data.status, 'draft');
  assert.equal(draft.data.job, null);
  assert.equal(draft.data.style, 'Soft folk');
  const missingReference = await call(`songs/${draft.data.id}/reference`, 'POST', {});
  assert.equal(missingReference.status, 400);
  assert.match(missingReference.data.error, /reference audio/i);
  const entity = songs.get(id);
  entity.sampleUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  entity.sampleSourceUrl = entity.sampleUrl;
  entity.sampleFile = `EncoreSample_${id}_test.mp3`;
  await writeFile(getSongFilePath(root, entity, entity.sampleFile), Buffer.alloc(256, 7));
  await store.save();
  const sample = (await call('songs/' + id)).data;
  assert.ok(sample.sampleAudio);
  assert.equal('sampleFile' in sample, false);
  const sampleRange = await fetch(new URL('../' + sample.sampleAudio, base), {
    headers: { Range: 'bytes=0-9' },
  });
  assert.equal(sampleRange.status, 206);
  assert.equal((await sampleRange.arrayBuffer()).byteLength, 10);
  const playlist = (await call('playlists', 'POST', { name: 'My playlist' })).data;
  assert.equal((await call('playlists/' + playlist.id, 'PATCH', { songIds: [id] })).status, 200);
  const copy = (await call('songs/' + id + '/copy', 'POST', { title: 'New direction' })).data;
  assert.ok(copy.audio);
  assert.equal(copy.title, 'Faran 2');
  assert.notEqual(copy.id, id);
  assert.equal((await call('songs/' + id, 'DELETE', { confirmation: id })).status, 200);
  await assert.rejects(access(getSongDirectory(root, id)), { code: 'ENOENT' });
  assert.equal((await fetch(base + 'audio/' + id)).status, 404);
  assert.equal((await fetch(base + 'audio/' + copy.id)).status, 200);
  assert.deepEqual((await call('library')).data.playlists[0].songIds, []);
  assert.equal((await call('playlists/' + playlist.id, 'DELETE')).status, 200);
  await assert.rejects(access(path.join(root, 'playlists', playlist.id)), {
    code: 'ENOENT',
  });
  assert.equal((await openLibraryStore(root)).state.songs[0].id, copy.id);
});
