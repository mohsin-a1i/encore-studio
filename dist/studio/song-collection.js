import { songStatuses } from '../songs/song-status.js';

export const studioSongGroups = songStatuses;
export const getStudioSongGroup = (song) => song.status;

const normalizeSearchText = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase();

export function filterStudioSongs(songs, query = '', filter = 'all') {
  const searchWords = normalizeSearchText(query).trim().split(/\s+/).filter(Boolean);
  return songs
    .filter((song) => {
      if (filter !== 'all' && getStudioSongGroup(song) !== filter) return false;
      const searchText = normalizeSearchText(
        [song.title, song.style, song.lyrics, song.sampleTitle].join(' '),
      );
      return searchWords.every((word) => searchText.includes(word));
    })
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}

export function countStudioSongs(songs) {
  const counts = Object.fromEntries(studioSongGroups.map(({ id }) => [id, 0]));
  for (const song of songs) counts[getStudioSongGroup(song)]++;
  return { all: songs.length, ...counts };
}
