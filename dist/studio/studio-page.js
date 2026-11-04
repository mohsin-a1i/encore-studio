import { renderEmptyState } from '../app/empty-state.js';
import { renderCreationBorder } from '../app/creation-card.js';
import { studioState } from '../app/browser-state.js';

import { renderIcon } from '../app/icons.js';
import { escapeHtml, getLyricsExcerpt } from '../app/text-helpers.js';
import { mediaUrl } from '../app/interface-helpers.js';
import { isSongGenerating, getSongStatusLabel } from '../songs/song-status.js';
import { initializeSongScrolling } from './collection-scrolling.js';

import {
  studioSongGroups,
  getStudioSongGroup,
  filterStudioSongs,
  countStudioSongs,
} from './song-collection.js';

import { getEditorSnapshotKey, renderSongEditor, updateEditorControls } from './editor-view.js';

export function renderStudioPage(connectionNotice = '') {
  return /* HTML */ `
    <section class="studio-workspace" aria-labelledby="studio-heading">
      <header class="studio-workspace-heading">
        <div>
          <span class="eyebrow">YOUR CREATIVE WORKSPACE</span>
          <h1 id="studio-heading">Your studio</h1>
          <p>A little idea. A whole world of sound.</p>
        </div>
      </header>
      ${connectionNotice}
      <div class="studio-layout">
        <aside class="studio-collection" aria-label="Your songs">
          <label class="collection-search studio-search">
            ${renderIcon('search', 'sm')}
            <input
              id="studio-search"
              type="search"
              placeholder="Search your songs…"
              aria-label="Search studio songs by title, style, or lyrics"
              value="${escapeHtml(studioState.studioQuery)}"
            />
          </label>
          <div
            class="studio-filters"
            data-studio-filters
            role="group"
            aria-label="Filter studio songs by status"
          >
            ${renderSongFilters()}
          </div>
          <p
            class="studio-result-count"
            data-studio-results
            aria-live="polite"
            ${describeSongResults() ? '' : 'hidden'}
          >
            ${describeSongResults()}
          </p>
          <div class="studio-song-viewport">
            <div
              id="studio-song-scroll"
              role="region"
              aria-label="Browse studio songs"
              tabindex="0"
            >
              <ul id="studio-song-list" data-key="${escapeHtml(getCollectionSnapshotKey())}">
                ${renderStudioSongList()}
              </ul>
            </div>
          </div>
        </aside>
        <div id="studio-editor" data-key="${escapeHtml(getEditorSnapshotKey())}">
          ${renderSongEditor()}
        </div>
      </div>
    </section>
  `;
}

function renderSongStatus(song) {
  return /* HTML */ `
    <span class="studio-status" data-status="${escapeHtml(song.status)}">
      <span class="studio-indicator" aria-hidden="true">
        ${isSongGenerating(song) ? '<i></i><i></i><i></i>' : song.status === 'ready' ? '' : renderIcon('note')}
      </span>
      <span>${getSongStatusLabel(song)}</span>
    </span>
  `;
}

function renderSongFilters() {
  const counts = countStudioSongs(studioState.songs);
  return [{ id: 'all', label: 'All songs' }, ...studioSongGroups]
    .map(
      ({ id, label }) =>
        `<button type="button" class="filter" data-action="studio-filter" data-value="${id}" aria-pressed="${studioState.studioFilter === id}"><span>${label}</span><span>${counts[id]}</span></button>`,
    )
    .join('');
}

function describeSongResults() {
  if (!studioState.studioQuery.trim() && studioState.studioFilter === 'all') return '';
  const count = filterStudioSongs(
    studioState.songs,
    studioState.studioQuery,
    studioState.studioFilter,
  ).length;
  return (
    count +
    (count === 1 ? ' song' : ' songs') +
    (studioState.studioQuery.trim() ? ' matching your search' : ' in view')
  );
}

function renderStudioSongList() {
  const createSong = /* HTML */ `
    <li class="studio-create-item">
      <button
        class="selection-card selection-create creation-card studio-create-song"
        data-action="new-song"
        ${studioState.pending ? 'disabled' : ''}
      >
        ${renderCreationBorder()} ${renderIcon('plus')}
        <span class="heading-stack">
          <span class="selection-name">New song</span>
          <small>Start with a spark</small>
        </span>
      </button>
    </li>
  `;
  const songs = filterStudioSongs(
    studioState.songs,
    studioState.studioQuery,
    studioState.studioFilter,
  );
  if (!songs.length) {
    if (!studioState.songs.length) return createSong;
    return (
      createSong +
      `<li>${renderEmptyState({ title: 'No songs match this view.', description: 'Try another search or show all your songs.', icon: 'search', action: { action: 'studio-reset', label: 'Show all songs' } })}</li>`
    );
  }
  return (
    createSong +
    [...studioSongGroups]
      .sort(
        (a, b) =>
          Number(
            songs.some((song) => isSongGenerating(song) && getStudioSongGroup(song) === b.id),
          ) -
          Number(songs.some((song) => isSongGenerating(song) && getStudioSongGroup(song) === a.id)),
      )
      .map(({ id, label }) => {
        const group = songs
          .filter((song) => getStudioSongGroup(song) === id)
          .sort((a, b) => Number(isSongGenerating(b)) - Number(isSongGenerating(a)));
        if (!group.length) return '';
        return (
          `<li class="studio-group-heading"><h3><span class="studio-group-label">${label}</span><span>${group.length}</span></h3></li>` +
          group
            .map((song) => {
              const excerpt = getLyricsExcerpt(song.lyrics);
              return `<li><button class="studio-song-card ${song.id === studioState.selectedSongId ? 'selected' : ''}" data-action="edit-song" data-id="${escapeHtml(song.id)}" data-group="${id}" data-processing="${isSongGenerating(song)}" aria-pressed="${song.id === studioState.selectedSongId}" aria-controls="studio-editor"><img src="${mediaUrl(song.cover)}" alt="" /><span class="studio-song-info"><strong dir="auto">${escapeHtml(song.title || 'Untitled song')}</strong><span class="studio-song-excerpt" dir="auto">${escapeHtml(excerpt)}</span>${renderSongStatus(song)}</span></button></li>`;
            })
            .join('')
        );
      })
      .join('')
  );
}

function getCollectionSnapshotKey() {
  return JSON.stringify([
    studioState.selectedSongId,
    studioState.pending,
    studioState.studioQuery,
    studioState.studioFilter,
    studioState.songs.map((song) => [song.id, song.updatedAt, song.status, song.cover]),
  ]);
}

export function refreshStudioPage() {
  const search = document.querySelector('#studio-search');
  if (search && search.value !== studioState.studioQuery) search.value = studioState.studioQuery;
  const updates = [['[data-studio-filters]', renderSongFilters()]];
  for (const [selector, html] of updates) {
    const target = document.querySelector(selector);
    if (target && target.innerHTML !== html) {
      const focusedFilter = target.contains(document.activeElement)
        ? document.activeElement.dataset.value
        : null;
      target.innerHTML = html;
      if (focusedFilter)
        target.querySelector(`[data-value="${focusedFilter}"]`)?.focus({ preventScroll: true });
    }
  }
  const results = document.querySelector('[data-studio-results]');
  if (results) {
    results.textContent = describeSongResults();
    results.hidden = !results.textContent;
  }
  const list = document.querySelector('#studio-song-list');
  if (list && list.dataset.key !== getCollectionSnapshotKey()) {
    const focused = list.contains(document.activeElement)
      ? document.activeElement.dataset.id
      : null;
    const viewport = document.querySelector('#studio-song-scroll');
    const scrollTop = viewport.scrollTop;
    list.innerHTML = renderStudioSongList();
    list.dataset.key = getCollectionSnapshotKey();
    if (focused)
      [...list.querySelectorAll('[data-id]')]
        .find((item) => item.dataset.id === focused)
        ?.focus({ preventScroll: true });
    viewport.scrollTop = scrollTop;
  }
  initializeSongScrolling();
  const editor = document.querySelector('#studio-editor');
  if (!editor || editor.dataset.key === getEditorSnapshotKey()) return;
  if (
    editor.querySelector?.('#song-editor-form')?._generating ||
    editor.querySelector?.('#song-editor-form')?._preparing
  )
    return;
  const focused = document.activeElement;
  if (
    !studioState.deletedSongIds?.includes(
      editor.querySelector?.('#song-editor-form')?.dataset.id,
    ) &&
    editor.contains(focused) &&
    /INPUT|TEXTAREA/.test(focused.tagName) &&
    !focused.disabled
  ) {
    const form = editor.querySelector?.('#song-editor-form');
    if (form) updateEditorControls(form);
    return;
  }
  editor.innerHTML = renderSongEditor();
  editor.dataset.key = getEditorSnapshotKey();
}
