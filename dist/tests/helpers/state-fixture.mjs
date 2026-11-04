import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openLibraryStore } from '../../library/library-store.mjs';
import { SongService } from '../../songs/song-service.mjs';
import { ExploreService } from '../../explore/explore-service.mjs';
import { PlaybackLeases } from '../../playback/playback-leases.mjs';
import { getSongFilePath } from '../../songs/song-record.mjs';
export async function stateFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'encore-state-'));
  const store = await openLibraryStore(root);
  store.state.profiles.push({ id: 'other', name: 'Other' });
  const songs = new SongService({
    store,
    renderer: {
      stop: async () => {},
      executeGeneration: async (song, job, { update }) => {
        song.audioFile = 'play.mp3';
        await writeFile(getSongFilePath(root, song, song.audioFile), 'test audio');
        await update('ready');
      },
    },
    writeMetadata: async () => ({
      title: 'Night drive',
      style: 'Indie pop',
      lyrics: '[Verse]\nOn the road',
      genres: ['Pop'],
    }),
  });
  songs.mediaUse = new PlaybackLeases();
  const explore = new ExploreService({
    store,
    songs,
    health: async () => ({ codex: true, comfy: true, workflow: true }),
  });
  async function settle() {
    await explore.exclusive(() => explore.fill());
    while (songs.generationPromise) await songs.generationPromise;
    await explore.exclusive(() => explore.fill());
  }
  t.after(async () => {
    explore.close();
    await explore.exclusive(async () => {
      while (songs.generationPromise) await songs.generationPromise;
    });
    await rm(root, { recursive: true, force: true });
  });
  const start = (profileId = 'guest', idea = 'Road trip', commandId = 'start-1') =>
    explore.start(profileId, {
      revision: explore.state(profileId).revision,
      idea,
      commandId,
    });
  return { root, store, songs, explore, settle, start };
}
