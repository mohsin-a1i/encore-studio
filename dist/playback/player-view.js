import { studioState, getPlayingSong, audio, getPlayableSongs } from '../app/browser-state.js';
import { renderIcon } from '../app/icons.js';
import { escapeHtml, formatPlaybackTime, getLyricsExcerpt } from '../app/text-helpers.js';
import { mediaUrl } from '../app/interface-helpers.js';
import { getSeekFraction } from './seek-progress.js';

export function renderPlayer() {
  const s = getPlayingSong() || getPlayableSongs()[0];
  return /* HTML */ `
    <footer
      class="player"
      aria-label="Music player"
      data-expanded="${studioState.playerExpanded}"
      data-playing="${studioState.playing}"
    >
      <button
        type="button"
        class="player-expand icon-button"
        data-action="player-expand"
        aria-expanded="${studioState.playerExpanded}"
        aria-label="${studioState.playerExpanded ? 'Collapse player' : 'Expand player controls'}"
      >
        ${renderIcon(studioState.playerExpanded ? 'chevron-down' : 'chevron-up')}
      </button>
      <div class="now-playing">
        <img id="player-cover" src="${mediaUrl(s?.cover)}" alt="${escapeHtml(s?.title)} cover" />
        <div>
          <strong id="player-title">${escapeHtml(s?.title || 'Your next favorite')}</strong>
          <small id="player-sub" dir="auto">${escapeHtml(getLyricsExcerpt(s?.lyrics))}</small>
        </div>
        <button
          class="icon-button ${s?.liked ? 'liked' : ''}"
          data-action="like"
          data-id="${escapeHtml(s?.id)}"
          aria-label="Favorite current song"
          ${s ? `` : `disabled`}
        >
          ${renderIcon('heart', 'sm')}
        </button>
      </div>
      <div class="player-mid">
        <div class="transport">
          <button
            class="aux ${studioState.shuffle ? 'liked' : ''}"
            data-action="shuffle"
            aria-label="Shuffle"
            aria-pressed="${studioState.shuffle}"
          >
            ${renderIcon('shuffle')}
          </button>
          <button class="prev" data-action="previous" aria-label="Previous song">
            ${renderIcon('prev')}
          </button>
          <button
            class="play-button"
            data-action="toggle"
            aria-label="${studioState.playing ? 'Pause' : 'Play'}"
            ${s ? `` : `disabled`}
          >
            ${renderIcon(studioState.playing ? 'pause' : 'play')}
          </button>
          <button data-action="next" aria-label="Next song">${renderIcon('next')}</button>
          <button
            class="aux ${studioState.repeat ? 'liked' : ''}"
            data-action="repeat"
            aria-label="Repeat"
            aria-pressed="${studioState.repeat}"
          >
            ${renderIcon('repeat')}
          </button>
        </div>
        <div class="progress">
          <span id="elapsed">${formatPlaybackTime(audio.currentTime)}</span>
          <div
            class="seek-bar"
            style="--seek-fraction: ${getSeekFraction(audio.currentTime, audio.duration || s?.duration || 100)}"
          >
            <label class="visually-hidden" for="seek">Song playback position</label>
            <input
              id="seek"
              type="range"
              min="0"
              max="${audio.duration || s?.duration || 100}"
              step=".1"
              value="${audio.currentTime || 0}"
              aria-label="Song playback position"
            />
            <svg width="0" height="0" aria-hidden="true" focusable="false">
              <defs>
                <clipPath id="seek-tail-curve" clipPathUnits="objectBoundingBox">
                  <path d="M 0 0.3 C 0.65 0.3 0.78 0 1 0 L 1 1 C 0.78 1 0.65 0.7 0 0.7 Z" />
                </clipPath>
              </defs>
            </svg>
            <span class="seek-handle" aria-hidden="true"></span>
            <span class="seek-sparks" aria-hidden="true">
              <i></i>
              <i></i>
              <i></i>
              <i></i>
              <i></i>
            </span>
          </div>
          <span id="total">${formatPlaybackTime(audio.duration || s?.duration)}</span>
        </div>
      </div>
      <div class="player-right">
        <button class="lyrics-button" data-action="current-lyrics">
          ${renderIcon('lyrics', 'sm')}
          <span>Lyrics</span>
        </button>
        <span class="vertical-line"></span>
        ${renderIcon('volume', 'sm')}
        <div
          class="seek-bar volume-bar"
          style="--seek-fraction: ${getSeekFraction(studioState.volume, 1)}"
        >
          <label class="visually-hidden" for="volume">Volume</label>
          <input
            type="range"
            id="volume"
            min="0"
            max="1"
            step=".01"
            value="${studioState.volume}"
            aria-label="Volume"
          />
          <span class="seek-handle" aria-hidden="true"></span>
        </div>
      </div>
    </footer>
  `;
}
