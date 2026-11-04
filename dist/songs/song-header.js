import { studioState } from '../app/browser-state.js';
import { renderIcon } from '../app/icons.js';
import { escapeHtml } from '../app/text-helpers.js';
import { mediaUrl } from '../app/interface-helpers.js';
import { renderCoverControl } from '../library/cover-controls.js';
import { getSongGenres } from './song-genres.js';
import { renderSongHeading } from './song-heading.js';

export function renderSongHeader(
  song,
  { editor = false, creating = false, active = false, edits = song, card = false } = {},
) {
  const id = escapeHtml(song.id);
  const draftTitle = edits.title || '';
  const title = draftTitle;
  const genres = getSongGenres(song);
  const duration = Number(song.duration);
  const playing = studioState.currentId === song.id && studioState.playing;
  const hasCover = !creating && Boolean(song.cover);
  const readOnly = editor && active;
  const emptyHeader =
    !editor && creating && !title.trim() && !genres.length && !(duration > 0) && !song.audio;

  return /* HTML */ `
    <header class="song-identity" ${hasCover ? '' : 'data-no-cover'} ${emptyHeader ? 'hidden' : ''}>
      ${hasCover ? (readOnly ? `<div class="song-cover-control"><img src="${escapeHtml(mediaUrl(song.cover))}" alt="${escapeHtml(song.title || 'Untitled song')} cover" /></div>` : renderCoverControl(song, active)) : ''}
      <div class="song-identity-copy">
        ${renderSongHeading(
          song,
          editor
            ? readOnly
              ? title.trim()
                ? `<div class="field song-title-field"><span>Song title</span><p class="song-title-static" dir="auto">${escapeHtml(title)}</p></div>`
                : ''
              : `<label class="field song-title-field"><span class="field-label">Song title</span><input id="song-title" dir="auto" name="title" value="${escapeHtml(title)}" placeholder="Song title" aria-label="Song title" /></label>`
            : title.trim()
              ? `<div class="field song-title-field">${card ? '' : '<span>Song title</span>'}<h2 id="modal-title" dir="auto">${escapeHtml(title)}</h2></div>`
              : '<h2 id="modal-title" hidden>Song details</h2>',
        )}
        ${card && song.style ? `<p class="song-detail-description" dir="auto" tabindex="0" aria-label="Musical style description">${escapeHtml(song.style)}</p>` : ''}
        ${
          readOnly
            ? ''
            : /* HTML */ `
                <div class="song-version-actions" role="group" aria-label="Song actions">
                  ${
                    song.audio
                      ? /* HTML */ `
                          <button
                            type="button"
                            class="button${card ? ' secondary' : ''} song-preview-button"
                            data-song-play
                            aria-pressed="${playing}"
                            data-action="play"
                            data-id="${id}"
                            ${editor ? 'title="Play saved song"' : ''}
                          >
                            ${renderIcon(playing ? 'pause' : 'play', 'sm')}${playing ? 'Pause' : 'Play song'}
                          </button>
                          <button
                            type="button"
                            class="button secondary song-download-button"
                            data-song-download
                            data-action="download-song"
                            data-id="${id}"
                            aria-label="Download song"
                            ${editor ? 'title="Download saved song"' : ''}
                          >
                            ${renderIcon('download', 'sm')}
                            <span>Download</span>
                          </button>
                        `
                      : ''
                  }
                  ${editor && !creating ? `<button type="button" class="button secondary song-copy-button" data-action="copy-song" data-id="${id}" aria-label="Make a copy" title="Duplicate the saved song to explore a new version">${renderIcon('copy', 'sm')}<span>Make a copy</span></button>` : ''}
                  ${!editor && song.audio ? `<button type="button" class="button secondary" data-action="share-song" data-id="${id}">${renderIcon('link', 'sm')}<span>Share song</span></button>` : ''}
                  ${editor ? '' : `<button type="button" class="button secondary" data-action="edit-song" data-id="${id}">${renderIcon('edit', 'sm')}<span>Open in studio</span></button>`}
                </div>
              `
        }
      </div>
    </header>
  `;
}
