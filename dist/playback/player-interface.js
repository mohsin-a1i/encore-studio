import { studioState, audio } from '../app/browser-state.js';
import { renderIcon } from '../app/icons.js';
import { formatPlaybackTime } from '../app/text-helpers.js';
import { updateSeekProgress } from './seek-progress.js';

export function updatePlaybackControls() {
  const player = document.querySelector('.player');
  if (player) player.dataset.playing = String(studioState.playing);
  document.querySelectorAll('[data-song-play]').forEach((button) => {
    const playing = button.dataset.id === studioState.currentId && studioState.playing;
    button.innerHTML =
      renderIcon(playing ? 'pause' : 'play', 'sm') + (playing ? 'Pause' : 'Play song');
    button.setAttribute('aria-pressed', playing);
  });
  const playButton = document.querySelector('.play-button');
  if (playButton) {
    playButton.innerHTML = renderIcon(studioState.playing ? 'pause' : 'play');
    playButton.setAttribute('aria-label', studioState.playing ? 'Pause' : 'Play');
  }
  document.querySelectorAll('.songs-table tr').forEach((songRow) => {
    const rowPlayButton = songRow.querySelector('.row-play');
    if (!rowPlayButton) return;
    if (rowPlayButton.dataset.id === studioState.currentId) {
      songRow.classList.add('active');
      rowPlayButton.innerHTML = renderIcon(studioState.playing ? 'pause' : 'play');
    } else {
      songRow.classList.remove('active');
      rowPlayButton.textContent = songRow.rowIndex;
    }
    const title = songRow.querySelector('.song-name')?.textContent.trim() || 'song';
    rowPlayButton.setAttribute(
      'aria-label',
      `${rowPlayButton.dataset.id === studioState.currentId && studioState.playing ? 'Pause' : 'Play'} ${title}`,
    );
  });
}

export function updatePlaybackProgress() {
  const seek = document.querySelector('#seek'),
    elapsed = document.querySelector('#elapsed'),
    total = document.querySelector('#total');
  if (seek) {
    seek.max = audio.duration || 100;
    seek.value = audio.currentTime;
    updateSeekProgress(seek);
  }
  if (elapsed) elapsed.textContent = formatPlaybackTime(audio.currentTime);
  if (total) total.textContent = formatPlaybackTime(audio.duration);
}
