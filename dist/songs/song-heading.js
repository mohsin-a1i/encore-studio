import { escapeHtml, formatPlaybackTime } from '../app/text-helpers.js';
import { renderIcon } from '../app/icons.js';
import { getSongGenres } from './song-genres.js';

export function renderSongMetadata(song) {
  const genres = getSongGenres(song);
  const duration = Number(song.duration);
  const hasDuration = Number.isFinite(duration) && duration > 0;
  if (!genres.length && !hasDuration) return '';
  return `<div class="song-header-meta" role="group" aria-label="Song metadata">${genres.map((genre) => `<span class="song-header-tag" title="Genre" dir="auto">${escapeHtml(genre)}</span>`).join('')}${hasDuration ? `<span class="song-header-time" title="Duration">${renderIcon('note', 'sm')}${formatPlaybackTime(duration)}</span>` : ''}</div>`;
}

export function renderSongHeading(
  song,
  titleMarkup = `<h2 dir="auto">${escapeHtml(song.title || 'Untitled song')}</h2>`,
) {
  return `<div class="song-heading heading-stack">${titleMarkup}${renderSongMetadata(song)}</div>`;
}
