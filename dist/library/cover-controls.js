import { escapeHtml } from '../app/text-helpers.js';
import { mediaUrl } from '../app/interface-helpers.js';
import { renderIcon } from '../app/icons.js';

export function renderCoverControl(song, disabled = false) {
  const title = song.title || 'Untitled song';
  return /* HTML */ `
    <button
      type="button"
      class="song-cover-control"
      data-action="upload-cover"
      data-kind="song"
      data-id="${escapeHtml(song.id)}"
      aria-label="Change cover for ${escapeHtml(title)}"
      title="Change cover"
      ${disabled ? 'disabled' : ''}
    >
      <img src="${mediaUrl(song.cover)}" alt="${escapeHtml(title)} cover" />
      <span>
        ${renderIcon('image', 'sm')}
        <span>Change cover</span>
      </span>
    </button>
  `;
}
