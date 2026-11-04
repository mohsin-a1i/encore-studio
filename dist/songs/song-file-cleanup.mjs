import { lstat, realpath, rm, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { requireSafeId } from '../server/request-security.mjs';
import { getSongFilePath, getSongDirectory } from './song-record.mjs';

const inside = (root, target) => target.startsWith(root + path.sep);

async function removeCollectionFolder(root, collection, id) {
  const base = path.resolve(root, collection);
  const target = path.resolve(base, requireSafeId(id));
  if (!inside(base, target) || path.dirname(target) !== base)
    throw new Error('Unsafe song folder.');
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const realBase = await realpath(base);
  const realData = await realpath(root);
  if (!inside(realData, realBase)) throw new Error('Unsafe song storage link.');
  if (info.isSymbolicLink()) return unlink(target);
  const resolved = await realpath(target);
  if (!inside(realBase, resolved) || path.dirname(resolved) !== realBase)
    throw new Error('Unsafe song folder link.');
  await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

export const removeSongFolder = (root, id) => removeCollectionFolder(root, 'songs', id);
export const removePlaylistFolder = (root, id) => removeCollectionFolder(root, 'playlists', id);

export async function removeComfyInputs(inputRoot, names = []) {
  // Existing songs can still own filenames created before the project rename.
  if (!inputRoot) return;
  const root = path.resolve(inputRoot);
  const realRoot = await realpath(root).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!realRoot) return;
  for (const name of names.filter(Boolean)) {
    if (
      path.basename(name) !== name ||
      !/^(?:Encore|Afterglow)Sample_[a-zA-Z0-9_-]+\.mp3$/.test(name)
    )
      throw new Error('Unsafe ComfyUI sample file.');
    const target = path.join(root, name);
    const info = await lstat(target).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!info) continue;
    if (info.isDirectory() || (!info.isSymbolicLink() && !inside(realRoot, await realpath(target))))
      throw new Error('Unsafe ComfyUI sample link.');
    await unlink(target);
  }
}

export async function removeComfyOutputs(outputRoot, jobIds) {
  if (!outputRoot || !jobIds?.length) return;
  const root = path.resolve(outputRoot);
  const realRoot = await realpath(root).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!realRoot) return;
  for (const name of await readdir(root)) {
    if (
      !jobIds.some((id) =>
        ['Encore', 'Afterglow'].some((brand) => name.startsWith(`${brand}_${id}_`)),
      ) ||
      !/\.(flac|mp3|wav|opus|txt)$/i.test(name)
    )
      continue;
    const file = path.resolve(root, name);
    const info = await lstat(file);
    if (!inside(root, file) || info.isDirectory()) throw new Error('Unsafe ComfyUI output.');
    if (!info.isSymbolicLink() && !inside(realRoot, await realpath(file)))
      throw new Error('Unsafe ComfyUI output link.');
    await unlink(file);
  }
}

async function finishAudioCleanup(store, song) {
  const remaining = [];
  for (const relative of song.pendingAudioFiles || []) {
    if (relative === song.audioFile || relative === song.masterFile) continue;
    try {
      const file = getSongFilePath(store.root, song, relative);
      const realData = await realpath(store.root);
      const realSongs = await realpath(path.join(store.root, 'songs'));
      const realSong = await realpath(getSongDirectory(store.root, song.id));
      const parent = await realpath(path.dirname(file));
      if (
        !inside(realData, realSongs) ||
        !inside(realSongs, realSong) ||
        (parent !== realSong && !inside(realSong, parent))
      )
        throw new Error('Unsafe audio storage link.');
      await unlink(file);
    } catch (error) {
      if (error.code !== 'ENOENT') remaining.push(relative);
    }
  }
  song.pendingAudioFiles = remaining;
  return remaining;
}

export async function cleanupUnusedSongAudio(store, song, previousFiles = []) {
  const names = await readdir(getSongDirectory(store.root, song.id));
  song.pendingAudioFiles = [
    ...new Set(
      [
        ...(song.pendingAudioFiles || []),
        ...previousFiles,
        ...names.filter((name) => /^(audio-|master-).+\.(mp3|flac|wav|opus)$/i.test(name)),
      ].filter((name) => name && name !== song.audioFile && name !== song.masterFile),
    ),
  ];
  // Save the active audio and pending cleanup before removing superseded or
  // incomplete renders. The current playable files are never cleanup targets.
  await store.save();
  const remaining = await finishAudioCleanup(store, song);
  await store.save();
  return remaining;
}

export async function clearSongSample(store, song, storage = {}) {
  await removeComfyInputs(storage.comfyInputRoot, [song.sampleFile]);
  if (song.sampleFile)
    song.pendingAudioFiles = [...new Set([...(song.pendingAudioFiles || []), song.sampleFile])];
  for (const key of [
    'referenceABC',
    'referenceABCSource',
    'referenceLyricPlan',
    'referenceLyricsGuide',
    'sampleKind',
    'sampleFile',
    'sampleSourceUrl',
    'sampleTitle',
    'sampleVideoId',
    'sampleDuration',
  ])
    delete song[key];
  await store.save();
  const remaining = await finishAudioCleanup(store, song);
  await store.save();
  if (remaining.length)
    throw new Error('The previous sample is still being released. Try again shortly.');
}

export async function finishSongCleanup(store, { comfyOutputRoot, comfyInputRoot } = {}) {
  let audioChanged = false;
  for (const song of store.state.songs) {
    if (!song.pendingAudioFiles?.length) continue;
    const count = song.pendingAudioFiles.length;
    await finishAudioCleanup(store, song);
    audioChanged ||= count !== song.pendingAudioFiles.length;
  }
  const remaining = [];
  for (const entry of store.state.pendingSongDeletions) {
    try {
      await removeComfyOutputs(comfyOutputRoot, entry.jobIds);
      await removeComfyInputs(comfyInputRoot, entry.sampleFiles);
      await removeSongFolder(store.root, entry.id);
    } catch {
      remaining.push(entry);
    }
  }
  if (audioChanged || remaining.length !== store.state.pendingSongDeletions.length) {
    store.state.pendingSongDeletions = remaining;
    await store.save();
  }
}
