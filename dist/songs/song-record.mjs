import path from 'node:path';
import { requireSafeId } from '../server/request-security.mjs';

export { isSongGenerating } from './song-status.js';

export function normalizeSongRecord(song) {
  if (!song.lyrics?.trim() && song.title === 'A song taking shape') song.title = '';
  if (!song.style?.trim() && song.genre === 'Original') song.genre = '';
  if (song.status === 'idea') song.status = 'draft';
  if (song.idea === undefined && typeof song.lyricsIdea === 'string') song.idea = song.lyricsIdea;
  delete song.lyricsIdea;
  if (!Array.isArray(song.genres)) song.genres = song.genre ? [song.genre] : [];
  song.genres = [
    ...new Set(
      song.genres
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  delete song.genre;
  delete song.mood;
  if (song.job) {
    delete song.job.idea;
    if (song.job.input) delete song.job.input.idea;
    if (song.job.input) {
      delete song.job.input.mood;
      delete song.job.input.genre;
    }
  }
}

export function getSongDirectory(root, id) {
  return path.join(root, 'songs', requireSafeId(id));
}

export function getSongFilePath(root, song, relative) {
  const folder = getSongDirectory(root, song.id);
  const target = path.resolve(folder, relative || '.');
  if (!relative || !target.startsWith(folder + path.sep)) throw new Error('Invalid song file.');
  return target;
}

export function getSongGenerationInput(song) {
  return Object.fromEntries(
    ['title', 'style', 'lyrics', 'genres', 'sampleUrl', 'sampleKind'].map((key) => [
      key,
      song[key] ?? '',
    ]),
  );
}

export function hasLoadedReference(song) {
  if (!song.sampleUrl && song.sampleKind !== 'upload') return true;
  return Boolean(
    song.referenceABC &&
    song.sampleFile &&
    song.referenceABCSource === song.sampleFile &&
    song.sampleSourceUrl === song.sampleUrl,
  );
}
