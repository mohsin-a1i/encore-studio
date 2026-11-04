import { renderEmptyState } from '../app/empty-state.js';
import { renderCreationBorder } from '../app/creation-card.js';
import {
  studioState,
  modalRoot,
  findSongById,
  getSelectedPlaylist,
  getPlayableSongs,
} from '../app/browser-state.js';
import { renderIcon } from '../app/icons.js';
import { escapeHtml } from '../app/text-helpers.js';
import { mediaUrl } from '../app/interface-helpers.js';
import { renderSongHeader } from '../songs/song-header.js';
import { isSongGenerating } from '../songs/song-status.js';

let modalReturnFocus;

export function closeDialog() {
  const returnFocus = studioState.modal?.kind?.startsWith('profile')
    ? document.querySelector('.profile-button') || modalReturnFocus
    : modalReturnFocus;
  modalRoot.innerHTML = '';
  studioState.modal = null;
  document.body.style.overflow = '';
  if (returnFocus?.matches?.('[aria-haspopup="dialog"]'))
    returnFocus.setAttribute('aria-expanded', 'false');
  returnFocus?.focus?.();
}
export function openDialog(title, body, footer = '', large = false, options = {}) {
  if (!modalRoot.firstElementChild) modalReturnFocus = document.activeElement;
  if (modalReturnFocus?.matches?.('[aria-haspopup="dialog"]'))
    modalReturnFocus.setAttribute('aria-expanded', 'true');
  modalRoot.innerHTML = /* HTML */ `
    <div class="modal-overlay ${escapeHtml(options.overlayClassName || '')}">
      <section
        class="modal ${large ? 'large' : ''} ${escapeHtml(options.className || '')}"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header class="modal-head">
          <div class="modal-heading">
            ${options.titleInBody ? `<span class="eyebrow">${escapeHtml(options.eyebrow || title)}</span>` : `<h2 id="modal-title" class="eyebrow" dir="auto">${escapeHtml(title)}</h2>`}
          </div>
          <div class="modal-head-actions" role="group" aria-label="Dialog controls">
            ${options.actions || ''}
            <button class="icon-button" data-action="close-modal" aria-label="Close dialog">
              ${renderIcon('close')}
            </button>
          </div>
        </header>
        <div class="modal-body">${body}</div>
        ${
          footer
            ? /* HTML */ `
                <footer class="modal-footer">${footer}</footer>
              `
            : ''
        }
      </section>
    </div>
  `;
  document.body.style.overflow = 'hidden';
  (
    modalRoot.querySelector('input:not([type=checkbox]),textarea') ||
    modalRoot.querySelector('.modal-head [data-action="close-modal"]')
  )?.focus();
}
export function renderLyricsSections(value) {
  if (!String(value || '').trim())
    return renderEmptyState({
      title: 'No lyrics',
      description: 'An instrumental story.',
      icon: 'lyrics',
    });
  const text = escapeHtml(String(value).trim());
  const content = text.replace(
    /\[([^\]]+)\]/g,
    (_tag, name, offset) =>
      `<span class="section-tag${offset === 0 ? ' section-tag-first' : ''}">${name}</span>`,
  );
  // Keep template indentation outside this pre-wrapped element.
  return '<div class="lyrics" dir="auto">' + content + '</div>';
}

function songPlaylists(song) {
  const memberships = studioState.playlists.filter((playlist) =>
    playlist.songIds.includes(song.id),
  );
  return /* HTML */ `
    <section
      class="song-detail-panel song-detail-playlists"
      aria-labelledby="song-playlists-heading"
    >
      <div class="song-detail-section-heading">
        <h3 id="song-playlists-heading">
          Playlists
          <span class="song-detail-count">${memberships.length}</span>
        </h3>
        <button
          type="button"
          class="icon-button"
          data-action="add-to-playlist"
          data-id="${escapeHtml(song.id)}"
          aria-label="Manage playlists"
          title="Manage playlists"
        >
          ${renderIcon('plus', 'sm')}
        </button>
      </div>
      ${
        memberships.length
          ? /* HTML */ `
              <ul class="song-playlist-list" aria-label="Playlists containing this song">
                ${memberships
                  .map(
                    (playlist) => /* HTML */ `
                      <li class="song-playlist-item">
                        <button
                          type="button"
                          class="song-playlist-link"
                          data-action="playlist"
                          data-id="${escapeHtml(playlist.id)}"
                          title="${escapeHtml(playlist.name)}"
                        >
                          <img src="${mediaUrl(playlist.cover)}" alt="" />
                          <span>
                            <strong>${escapeHtml(playlist.name)}</strong>
                            <small>
                              ${playlist.songIds.length}
                              ${playlist.songIds.length === 1 ? 'song' : 'songs'}
                            </small>
                          </span>
                        </button>
                        <button
                          type="button"
                          class="icon-button song-playlist-remove"
                          data-action="remove-song-from-playlist"
                          data-playlist-id="${escapeHtml(playlist.id)}"
                          data-id="${escapeHtml(song.id)}"
                          aria-label="Remove from ${escapeHtml(playlist.name)}"
                          title="Remove from ${escapeHtml(playlist.name)}"
                        >
                          ${renderIcon('close', 'sm')}
                        </button>
                      </li>
                    `,
                  )
                  .join('')}
              </ul>
            `
          : renderEmptyState({
              title: 'Not in a playlist yet',
              description: 'Add this song to a collection.',
              icon: 'library',
              action: { action: 'add-to-playlist', id: song.id, label: 'Manage playlists' },
            })
      }
    </section>
  `;
}

export function openSongDetails(id) {
  const song = findSongById(id);
  if (!song) return;
  studioState.modal = { kind: 'song', id };
  openDialog(
    song.title,
    /* HTML */ `
      <div class="song-detail-main">
        ${renderSongHeader(song, { active: isSongGenerating(song), card: true })}
        <div class="song-detail-sidebar">${songPlaylists(song)}</div>
        <div class="song-detail-body">
          <section
            class="song-detail-panel song-detail-lyrics"
            aria-labelledby="song-lyrics-heading"
          >
            <div class="song-detail-section-heading">
              <h3 id="song-lyrics-heading">Lyrics</h3>
              <button
                class="icon-button"
                data-action="copy-lyrics"
                data-id="${escapeHtml(id)}"
                aria-label="Copy lyrics"
                title="Copy lyrics"
                ${song.lyrics?.trim() ? '' : 'disabled'}
              >
                ${renderIcon('copy', 'sm')}
              </button>
            </div>
            ${renderLyricsSections(song.lyrics)}
          </section>
        </div>
      </div>
    `,
    '',
    true,
    {
      className: 'song-detail',
      eyebrow: 'SONG DETAILS',
      titleInBody: true,
      actions: `<button type="button" class="icon-button song-detail-delete" data-action="delete-song" data-id="${escapeHtml(id)}" aria-label="Delete song" title="Delete song">${renderIcon('trash', 'sm')}</button>`,
    },
  );
  studioState.modal = { kind: 'song', id };
}
export function openPlaylistEditor(edit = false, songId = null) {
  const playlist = edit ? getSelectedPlaylist() : null;
  studioState.modal = { kind: 'playlist-form', id: playlist?.id };
  openDialog(
    edit ? 'Edit playlist' : 'Create a playlist',
    /* HTML */ `
      <form id="playlist-form" data-base-revision="${playlist?.editRevision || 0}">
        <label class="field">
          <span class="field-label">Playlist name</span>
          <input
            id="playlist-name"
            aria-describedby="playlist-name-help"
            name="name"
            placeholder="Sunday kind of feeling"
            required
            maxlength="70"
            value="${escapeHtml(playlist?.name)}"
          />
          <span class="field-message" id="playlist-name-help" data-field-help>
            Give your collection a name and make it yours.
          </span>
        </label>
        <label class="field">
          <span class="field-label">
            Description
            <span class="optional">Optional</span>
          </span>
          <textarea
            id="playlist-description"
            aria-describedby="playlist-description-help"
            name="description"
            placeholder="What belongs in this collection?"
            maxlength="240"
            rows="3"
          >
${escapeHtml(playlist?.description)}</textarea>
          <span class="field-message" id="playlist-description-help" data-field-help>
            Describe the sounds that belong in this collection.
          </span>
        </label>
        <p class="playlist-dialog-note">
          ${edit ? 'You can change the cover from the playlist page.' : 'A cover will be created for your playlist. You can change it later.'}
        </p>
        <div class="modal-footer">
          ${songId ? `<button type="button" class="button secondary" data-action="add-to-playlist" data-id="${escapeHtml(songId)}">Back</button>` : '<button type="button" class="button secondary" data-action="close-modal">Cancel</button>'}
          <button class="button">${edit ? 'Save changes' : 'Create playlist'}</button>
        </div>
      </form>
    `,
  );
  studioState.modal = { kind: 'playlist-form', id: playlist?.id, songId };
}
export function openPlaylistSelection(kind, id) {
  if (kind === 'add-to-playlist') {
    const song = findSongById(id);
    if (!song) return;
    openDialog(
      'Manage playlists',
      /* HTML */ `
        <p class="playlist-dialog-intro">
          Choose where to keep “${escapeHtml(song.title || 'this song')}”.
        </p>
        <div class="playlist-selection">
          <div class="playlist-selection-list selection-grid">
            ${
              studioState.playlists.length
                ? `<button
              type="button"
              class="selection-card selection-create creation-card"
              data-action="new-playlist"
              data-playlist-management-action
            >
              ${renderCreationBorder()}${renderIcon('plus')}
              <span class="selection-name">New playlist</span>
            </button>`
                : renderEmptyState({
                    title: 'No playlists yet',
                    description: 'Create a collection for this song.',
                    icon: 'library',
                    action: { action: 'new-playlist', label: 'New playlist', management: true },
                  })
            }
            ${studioState.playlists
              .map(
                (playlist) => /* HTML */ `
                  <label class="selection-card selection-item">
                    <img src="${mediaUrl(playlist.cover)}" alt="" />
                    <span class="selection-name" dir="auto" title="${escapeHtml(playlist.name)}">
                      ${escapeHtml(playlist.name)}
                    </span>
                    <input
                      type="checkbox"
                      data-playlist-membership
                      data-playlist-id="${escapeHtml(playlist.id)}"
                      data-song-id="${escapeHtml(id)}"
                      ${playlist.songIds.includes(id) ? 'checked' : ''}
                    />
                  </label>
                `,
              )
              .join('')}
          </div>
          <p
            class="playlist-save-status"
            role="status"
            aria-live="polite"
            data-playlist-save-status
          ></p>
          <div class="modal-footer">
            <button
              type="button"
              class="button"
              data-action="song"
              data-id="${escapeHtml(id)}"
              data-playlist-management-action
            >
              Done
            </button>
          </div>
        </div>
      `,
      '',
      true,
    );
  } else {
    const playlist = getSelectedPlaylist();
    openDialog(
      'Choose songs',
      /* HTML */ `
        <form id="selection-form">
          <p class="playlist-dialog-intro">
            Select the songs you want in “${escapeHtml(playlist.name)}”.
          </p>
          <div class="playlist-selection-list selection-grid">
            ${
              getPlayableSongs().length
                ? getPlayableSongs()
                    .map(
                      (song) => /* HTML */ `
                        <label class="selection-card selection-item">
                          <img src="${mediaUrl(song.cover)}" alt="" />
                          <span
                            class="selection-name"
                            dir="auto"
                            title="${escapeHtml(song.title || 'Untitled song')}"
                          >
                            ${escapeHtml(song.title || 'Untitled song')}
                          </span>
                          <input
                            type="checkbox"
                            name="selection"
                            value="${escapeHtml(song.id)}"
                            ${playlist.songIds.includes(song.id) ? 'checked' : ''}
                          />
                        </label>
                      `,
                    )
                    .join('')
                : renderEmptyState({
                    title: 'No playable songs yet',
                    description: 'Your finished songs will appear here.',
                    action: { action: 'nav', view: 'create', label: 'Create a song' },
                  })
            }
          </div>
          <div class="modal-footer">
            <button type="button" class="button secondary" data-action="close-modal">Cancel</button>
            <button class="button">Save songs</button>
          </div>
        </form>
      `,
      '',
      true,
    );
  }
  studioState.modal = {
    kind,
    id,
    ...(kind === 'add-songs'
      ? {
          revision: studioState.playlists.find((item) => item.id === id)?.editRevision || 0,
        }
      : {}),
  };
}
export function confirmSongDeletion(id) {
  const song = findSongById(id);
  if (!song) return;
  openDialog(
    'Delete this song completely?',
    '<p class="help">“' +
      escapeHtml(song.title) +
      '” and its lyrics, style, audio, sample audio, artwork, workflow, and generation data will be deleted. It will also be removed from every playlist.</p><p class="help">This cannot be undone.</p>',
    '<button class="button secondary" data-action="close-modal">Keep song</button><button class="button danger" data-action="confirm-delete-song" data-id="' +
      escapeHtml(id) +
      '">Delete song completely</button>',
  );
}
