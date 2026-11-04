import { workspace } from '../profiles/profile-workspace.mjs';
import { readFile, writeFile, rename, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { isSongGenerating, getSongDirectory, normalizeSongRecord } from '../songs/song-record.mjs';
import { defaultProfileId } from '../profiles/profile-records.mjs';
import { normalizeSongStatus, getIdleSongStatus } from '../songs/song-status.js';

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await writeFile(file + '.tmp', JSON.stringify(value, null, 2) + '\n');
  await rename(file + '.tmp', file);
}

export async function openLibraryStore(root) {
  await mkdir(path.join(root, 'songs'), { recursive: true });
  const file = path.join(root, 'library.json');
  const index = await readJson(file, {
    version: 2,
    playlists: [],
    deletedSongIds: [],
    pendingSongDeletions: [],
  });
  if ((index.songs?.length || index.jobs?.length || index.drafts?.length) && index.version !== 2)
    throw new Error('Legacy studio data must be cleared before opening the unified song store.');
  const state = {
    revision: index.revision || 0,
    profiles: index.profiles?.length
      ? index.profiles
      : [
          {
            id: defaultProfileId,
            name: 'Guest',
            createdAt: new Date().toISOString(),
          },
        ],
    songs: [],
    playlists: index.playlists || [],
    deletedSongIds: index.deletedSongIds || [],
    deletedSongProfiles: index.deletedSongProfiles || {},
    deletedSongRequests: index.deletedSongRequests || {},
    pendingSongDeletions: index.pendingSongDeletions || [],
  };
  state.profiles.forEach(workspace);
  for (const playlist of state.playlists) playlist.profileId ||= defaultProfileId;
  for (const entry of state.pendingSongDeletions) entry.profileId ||= defaultProfileId;
  for (const id of state.deletedSongIds) state.deletedSongProfiles[id] ||= defaultProfileId;
  for (const entry of await readdir(path.join(root, 'songs'), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory() || state.deletedSongIds.includes(entry.name)) continue;
    const song = await readJson(path.join(getSongDirectory(root, entry.name), 'song.json'), null);
    if (!song) continue;
    if (song.id !== entry.name) throw new Error('A song record does not match its folder.');
    song.profileId ||= defaultProfileId;
    normalizeSongRecord(song);
    normalizeSongStatus(song);
    if (song.referencePreparation?.phase) {
      delete song.referencePreparation.phase;
      song.referencePreparation.outcome = 'failed';
      song.referencePreparation.error =
        'The studio restarted while preparing this reference. Try again.';
      song.referencePreparation.finishedAt = new Date().toISOString();
    }
    const work = path.join(getSongDirectory(root, song.id), 'work');
    for (const job of await readdir(work, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    })) {
      if (!job.isDirectory()) continue;
      await unlink(path.join(work, job.name, 'lyrics-prompt.txt')).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    if (isSongGenerating(song)) {
      song.status = getIdleSongStatus(song);
      song.error = 'The studio restarted during generation. Review the song and try again.';
      if (song.job) {
        song.job.finishedAt = new Date().toISOString();
        song.job.outcome = 'failed';
        delete song.job.phase;
      }
    }
    state.songs.push(song);
  }
  state.songs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  let pending = Promise.resolve();
  const listeners = new Set();
  let revision = state.revision;
  let committedRevision = revision;
  const save = () => {
    state.songs.forEach(normalizeSongRecord);
    state.songs.forEach(normalizeSongStatus);
    // Snapshot before queuing writes so progress and UI edits persist in order.
    state.revision = ++revision;
    const snapshot = structuredClone(state);
    const snapshotRevision = revision;
    pending = pending
      .catch(() => {})
      .then(async () => {
        for (const song of snapshot.songs) {
          const folder = getSongDirectory(root, song.id);
          await mkdir(folder, { recursive: true });
          await writeJson(path.join(folder, 'song.json'), song);
        }
        const { songs: _songs, ...library } = snapshot;
        await writeJson(file, { version: 2, ...library });
        committedRevision = snapshotRevision;
        for (const listener of listeners) listener(snapshot, snapshotRevision);
      });
    return pending;
  };
  await save();
  return {
    root,
    state,
    save,
    get revision() {
      return revision;
    },
    get committedRevision() {
      return committedRevision;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
