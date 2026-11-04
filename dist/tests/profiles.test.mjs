import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, access, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openLibraryStore } from '../library/library-store.mjs';
import { libraryRoutes } from '../library/library-routes.mjs';
import { songRoutes } from '../songs/song-routes.mjs';
import { mediaRoutes } from '../songs/media-routes.mjs';
import { SongService } from '../songs/song-service.mjs';
import { profileRoutes } from '../profiles/profile-routes.mjs';
import { requireProfile } from '../profiles/profile-records.mjs';
import { sendJsonResponse } from '../server/http-responses.mjs';

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'encore-profiles-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await openLibraryStore(root);
  const storage = {
    comfyInputRoot: path.join(root, 'comfy-input'),
    comfyOutputRoot: path.join(root, 'comfy-output'),
  };
  for (const folder of Object.values(storage)) await mkdir(folder);
  const songs = new SongService({
    store,
    storage,
    renderer: { stop: async () => {} },
    writeLyrics: async () => ({
      title: 'A new song',
      style: 'Pop',
      lyrics: '[Verse]\nHello again',
      genres: ['Pop'],
    }),
  });
  const idle = async () => {
    while (songs.generationPromise) await songs.generationPromise;
  };
  t.after(idle);
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://studio');
      const routeSegments = url.pathname.split('/').filter(Boolean);
      const profileId =
        request.headers['x-profile-id'] || url.searchParams.get('profile') || 'guest';
      if (routeSegments[1] !== 'profiles') requireProfile(store, profileId);
      const route =
        routeSegments[1] === 'profiles'
          ? profileRoutes
          : routeSegments[1] === 'songs'
            ? songRoutes
            : ['library', 'playlists'].includes(routeSegments[1])
              ? libraryRoutes
              : mediaRoutes;
      await route({
        request,
        response,
        routeSegments,
        profileId,
        store,
        songs,
        dataRoot: root,
        health: async () => ({ codex: true, comfy: true }),
      });
    } catch (error) {
      sendJsonResponse(response, error.status || 500, { error: error.message });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  const call = async (route, profileId = 'guest', method = 'GET', input) => {
    const response = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Profile-Id': profileId },
      body: input && JSON.stringify(input),
    });
    return { status: response.status, data: await response.json() };
  };
  return { root, store, songs, storage, idle, call, base };
}

test('profiles isolate collections, favorites, playlists, edits, copies and media', async (t) => {
  const { root, store, idle, call, base } = await setup(t);
  assert.equal((await call('library')).data.profile.name, 'Guest');
  assert.equal((await call('profiles', 'guest', 'POST', { name: '  ' })).status, 400);
  const profile = (await call('profiles', 'guest', 'POST', { name: '  Mohsin  ' })).data;
  assert.equal(profile.name, 'Mohsin');
  const guestSong = (await call('songs', 'guest', 'POST', { idea: 'Guest idea' })).data;
  await idle();
  const otherSong = (await call('songs', profile.id, 'POST', { idea: 'Private idea' })).data;
  await idle();
  await call('songs/' + otherSong.id, profile.id, 'PATCH', { liked: true });
  const otherRecord = store.state.songs.find((song) => song.id === otherSong.id);
  otherRecord.audioFile = 'audio-test.mp3';
  await writeFile(path.join(root, 'songs', otherSong.id, otherRecord.audioFile), 'audio');
  await store.save();
  const playlist = (await call('playlists', profile.id, 'POST', { name: 'My songs' })).data;
  assert.equal(
    (await call('playlists/' + playlist.id, 'guest', 'PATCH', { name: 'Wrong owner' })).status,
    404,
  );
  assert.equal(
    (await call('songs/' + otherSong.id, 'guest', 'PATCH', { liked: false })).status,
    404,
  );
  assert.equal((await call('songs/' + otherSong.id + '/copy', 'guest', 'POST', {})).status, 404);
  assert.equal(
    (await call('playlists/' + playlist.id, profile.id, 'PATCH', { songIds: [guestSong.id] }))
      .status,
    400,
  );
  await call('playlists/' + playlist.id, profile.id, 'PATCH', { songIds: [otherSong.id] });
  const copy = (await call('songs/' + otherSong.id + '/copy', profile.id, 'POST', {})).data;
  assert.equal(copy.profileId, profile.id);
  const guestLibrary = (await call('library')).data;
  const otherLibrary = (await call('library', profile.id)).data;
  assert.deepEqual(
    guestLibrary.songs.map((song) => song.id),
    [guestSong.id],
  );
  assert.deepEqual(guestLibrary.playlists, []);
  assert.equal(otherLibrary.songs.length, 2);
  assert.equal(otherLibrary.songs.find((song) => song.id === otherSong.id).liked, true);
  assert.deepEqual(otherLibrary.playlists[0].songIds, [otherSong.id]);
  assert.equal((await fetch(base + 'audio/' + otherSong.id)).status, 404);
  assert.equal(
    (
      await fetch(
        base +
          otherLibrary.songs.find((song) => song.id === otherSong.id).audio.replace('api/', ''),
      )
    ).status,
    200,
  );
  assert.equal((await fetch(base + 'cover/playlist/' + playlist.id)).status, 404);
  assert.equal(
    (await call('profiles/' + profile.id, 'guest', 'PATCH', { name: 'New name' })).data.name,
    'New name',
  );
  assert.equal(
    (await openLibraryStore(root)).state.profiles.find((item) => item.id === profile.id).name,
    'New name',
  );
});

test('deleting a profile removes its data and generated files while preserving other profiles', async (t) => {
  const { root, store, idle, call, storage } = await setup(t);
  const profile = (await call('profiles', 'guest', 'POST', { name: 'To delete' })).data;
  const keep = (await call('songs', 'guest', 'POST', { idea: 'Keep me' })).data;
  await idle();
  const remove = (await call('songs', profile.id, 'POST', { idea: 'Remove me' })).data;
  await idle();
  const record = store.state.songs.find((song) => song.id === remove.id);
  const sample = `EncoreSample_${remove.id}_reference.mp3`;
  record.sampleFile = sample;
  record.renderIds.push('render-owned');
  await writeFile(path.join(root, 'songs', remove.id, sample), 'sample');
  await mkdir(path.join(root, 'songs', remove.id, 'work'), { recursive: true });
  await writeFile(path.join(root, 'songs', remove.id, 'work', 'job.json'), 'job');
  await writeFile(path.join(storage.comfyInputRoot, sample), 'input');
  await writeFile(path.join(storage.comfyOutputRoot, 'Encore_render-owned_audio.mp3'), 'render');
  await writeFile(path.join(storage.comfyOutputRoot, 'Encore_keep_audio.mp3'), 'keep');
  await store.save();
  const playlist = (await call('playlists', profile.id, 'POST', { name: 'Remove playlist' })).data;
  assert.equal((await call('profiles/' + profile.id, 'guest', 'DELETE', {})).status, 400);
  assert.equal(
    (await call('profiles/' + profile.id, 'guest', 'DELETE', { confirmation: profile.id })).status,
    200,
  );
  for (const file of [
    path.join(root, 'songs', remove.id),
    path.join(root, 'playlists', playlist.id),
    path.join(storage.comfyInputRoot, sample),
    path.join(storage.comfyOutputRoot, 'Encore_render-owned_audio.mp3'),
  ])
    await assert.rejects(access(file), { code: 'ENOENT' });
  await access(path.join(root, 'songs', keep.id, 'song.json'));
  await access(path.join(storage.comfyOutputRoot, 'Encore_keep_audio.mp3'));
  assert.equal((await call('library', profile.id)).status, 404);
  const restored = await openLibraryStore(root);
  assert.equal(
    restored.state.profiles.some((item) => item.id === profile.id),
    false,
  );
  assert.deepEqual(
    restored.state.songs.map((song) => song.id),
    [keep.id],
  );
  const deletedLast = await call('profiles/guest', 'guest', 'DELETE', { confirmation: 'guest' });
  assert.equal(deletedLast.data.profiles.length, 1);
  assert.equal(deletedLast.data.profiles[0].name, 'Guest');
  assert.notEqual(deletedLast.data.profiles[0].id, 'guest');
  assert.deepEqual((await call('library', deletedLast.data.profiles[0].id)).data.songs, []);
});

test('profile deletion stops active writing and removes queued songs without starting them', async (t) => {
  const { root, songs, call } = await setup(t);
  const profile = (await call('profiles', 'guest', 'POST', { name: 'Busy profile' })).data;
  let writingStarted;
  const started = new Promise((resolve) => {
    writingStarted = resolve;
  });
  let writes = 0;
  songs.writeLyrics = ({ onStart }) =>
    new Promise((resolve, reject) => {
      writes++;
      onStart({ kill: () => reject(new Error('Stopped')) });
      writingStarted();
    });
  const first = (await call('songs', profile.id, 'POST', { idea: 'Active song' })).data;
  await started;
  const queued = (await call('songs', profile.id, 'POST', { idea: 'Queued song' })).data;
  assert.equal(
    (await call('profiles/' + profile.id, 'guest', 'DELETE', { confirmation: profile.id })).status,
    200,
  );
  assert.equal(writes, 1);
  assert.equal(songs.activeSongId, null);
  await assert.rejects(access(path.join(root, 'songs', first.id)), { code: 'ENOENT' });
  await assert.rejects(access(path.join(root, 'songs', queued.id)), { code: 'ENOENT' });
});

test('existing songs and playlists migrate to Guest without moving or losing files', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'encore-profile-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'songs', 'old-song'), { recursive: true });
  await writeFile(
    path.join(root, 'songs', 'old-song', 'song.json'),
    JSON.stringify({
      id: 'old-song',
      title: 'Existing song',
      createdAt: '2026-10-01',
      lyrics: 'Hello',
      status: 'ready',
      audioFile: 'audio.mp3',
      liked: true,
    }),
  );
  await writeFile(path.join(root, 'songs', 'old-song', 'audio.mp3'), 'original audio');
  await writeFile(
    path.join(root, 'library.json'),
    JSON.stringify({
      version: 2,
      playlists: [{ id: 'old-playlist', name: 'Existing playlist', songIds: ['old-song'] }],
    }),
  );
  const store = await openLibraryStore(root);
  assert.equal(store.state.profiles[0].name, 'Guest');
  assert.equal(store.state.songs[0].profileId, 'guest');
  assert.equal(store.state.playlists[0].profileId, 'guest');
  assert.equal(store.state.songs[0].liked, true);
  assert.equal(
    await readFile(path.join(root, 'songs', 'old-song', 'audio.mp3'), 'utf8'),
    'original audio',
  );
});
