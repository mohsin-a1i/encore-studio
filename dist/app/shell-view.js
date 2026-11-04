import { renderEmptyState } from './empty-state.js';
import { studioState, getSelectedPlaylist, getPlayableSongs } from './browser-state.js';
import { renderIcon } from './icons.js';
import { escapeHtml } from './text-helpers.js';
import {
  renderHomePage,
  renderPlaylistCard,
  renderPlaylistPage,
  renderLibraryFilters,
  renderSongList,
  getFilteredSongs,
} from '../library/library-page.js';
import { renderStudioPage } from '../studio/studio-page.js';
import { renderPlayer } from '../playback/player-view.js';
import {
  allServicesConnected,
  isServiceConnected,
  connectionServices,
} from '../settings/connection-status.js';
import { renderSettingsPage } from '../settings/settings-page.js';
import { renderExplorePage } from '../explore/explore-page.js';

function renderNavigationButton(view, label, name) {
  return /* HTML */ `
    <button
      data-action="nav"
      data-view="${view}"
      class="${studioState.view === view ? 'active' : ''}"
      aria-label="${label}"
      ${studioState.view === view ? 'aria-current="page"' : ''}
      title="${label}"
    >
      ${renderIcon(name)}
      <span>${label}</span>
    </button>
  `;
}
function renderStudioNavigation() {
  return /* HTML */ `
    <button
      class="create-nav ${studioState.view === 'create' ? 'active' : ''}"
      data-action="nav"
      data-view="create"
      aria-label="Your studio"
      ${studioState.view === 'create' ? 'aria-current="page"' : ''}
      title="Your studio — Idea to encore"
    >
      <span class="studio-nav-art" aria-hidden="true">
        <svg class="studio-nav-wave" viewBox="0 0 28 28" fill="currentColor">
          <rect x="3" y="11" width="3" height="6" rx="1.5" />
          <rect x="8" y="6" width="3" height="16" rx="1.5" />
          <rect x="13" y="3" width="3" height="22" rx="1.5" />
          <rect x="18" y="8" width="3" height="12" rx="1.5" />
          <rect x="23" y="11" width="3" height="6" rx="1.5" />
        </svg>
        ${renderIcon('spark', 'studio-nav-spark')}
      </span>
      <span class="studio-nav-copy heading-stack">
        <strong>Your studio</strong>
        <small>Idea to encore</small>
      </span>
    </button>
  `;
}
export function renderApplicationShell() {
  const viewLabel =
    studioState.view === 'playlist'
      ? getSelectedPlaylist()?.name
      : {
          home: 'Overview',
          create: 'Your studio',
          explore: 'Explore',
          library: 'Your library',
          favorites: 'Favorites',
          playlists: 'Playlists',
          settings: 'Settings',
        }[studioState.view] || 'Overview';
  return /* HTML */ `
    <button
      type="button"
      class="nav-scrim"
      data-action="close-navigation"
      aria-label="Close navigation"
      tabindex="-1"
      ${studioState.navigationOpen ? '' : 'hidden'}
    ></button>
    <aside
      id="main-navigation"
      class="sidebar"
      data-open="${studioState.navigationOpen}"
      aria-label="Navigation"
    >
      <button
        type="button"
        class="navigation-close icon-button"
        data-action="close-navigation"
        aria-label="Close navigation"
      >
        ${renderIcon('close')}
      </button>
      <button
        type="button"
        class="brand"
        data-action="nav"
        data-view="home"
        aria-label="Encore home"
      >
        ${renderIcon('spark')}
        <span>
          <strong class="brand-title">encore</strong>
          <small>MUSIC STUDIO</small>
        </span>
      </button>
      <nav class="nav" aria-label="Main navigation">
        ${renderStudioNavigation()}${renderNavigationButton('home', 'Overview', 'home')}${renderNavigationButton('explore', 'Explore', 'search')}${renderNavigationButton('library', 'Your library', 'library')}${renderNavigationButton('favorites', 'Favorites', 'heart')}
        ${renderNavigationButton('settings', 'Settings', 'settings')}
      </nav>
      <div class="side-footer">
        <div class="signature">A little feeling. A whole new sound.</div>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <button
          type="button"
          class="navigation-toggle icon-button"
          data-action="toggle-navigation"
          aria-label="Open navigation"
          aria-controls="main-navigation"
          aria-expanded="${studioState.navigationOpen}"
        >
          ${renderIcon('menu')}
        </button>
        <div class="crumb">
          <span>Your workspace</span>
          <span>/</span>
          <span>${escapeHtml(viewLabel)}</span>
        </div>
        <button
          type="button"
          class="mobile-brand"
          data-action="nav"
          data-view="home"
          aria-label="Encore home"
        >
          ${renderIcon('spark')}
          <span>encore</span>
        </button>
        <div class="top-right">
          <button
            type="button"
            class="profile-button"
            data-action="profiles"
            aria-label="Profiles for ${escapeHtml(studioState.profile?.name || 'Guest')}"
            aria-haspopup="dialog"
            aria-controls="modal-root"
            aria-expanded="${Boolean(studioState.modal?.kind?.startsWith('profile'))}"
            title="${escapeHtml(studioState.profile?.name || 'Guest')} — Your profiles"
          >
            <span class="avatar" aria-hidden="true">
              ${escapeHtml(Array.from(studioState.profile?.name || 'Guest')[0].toUpperCase())}
            </span>
          </button>
        </div>
      </header>
      <div id="content">${renderCurrentPage()}</div>
    </main>
    ${renderPlayer()}
  `;
}
export function renderCurrentPage() {
  if (studioState.view === 'settings') return renderSettingsPage();
  const offline = !allServicesConnected()
    ? /* HTML */ `
        <button class="offline-note" data-action="nav" data-view="settings">
          <span>
            ${connectionServices
              .filter(({ id }) => !isServiceConnected(id))
              .map(({ name }) => name)
              .join(', ')}
            not connected.
          </span>
          <span class="offline-note-action">Open settings</span>
        </button>
      `
    : '';
  return renderPageContent(offline);
}

function renderPageContent(offline) {
  const intro = (...args) => renderPageIntro(...args) + offline;
  if (studioState.view === 'create') return renderStudioPage(offline);
  if (studioState.view === 'explore') return renderExplorePage(offline);
  if (studioState.view === 'playlist')
    return intro('CURATED BY YOU', 'A place for every sound.', '') + renderPlaylistPage();
  if (studioState.view === 'playlists')
    return (
      intro(
        'YOUR COLLECTIONS',
        'Good songs belong together.',
        'Build a soundtrack for every version of you.',
      ) +
      /* HTML */ `
        <div class="section-head">
          <span>${studioState.playlists.length} playlists</span>
          <button class="button" data-action="new-playlist">
            ${renderIcon('plus', 'sm')}
            <span>New playlist</span>
          </button>
        </div>
        <div class="playlist-grid-expanded">
          ${studioState.playlists.length ? studioState.playlists.map(renderPlaylistCard).join('') : renderEmptyState({ title: 'No playlists yet', description: 'Give your songs a place to belong.', icon: 'library', action: { action: 'new-playlist', label: 'New playlist' } })}
        </div>
      `
    );
  if (['library', 'favorites'].includes(studioState.view))
    return (
      intro(
        studioState.view === 'favorites' ? 'ON REPEAT' : 'YOUR COLLECTION',
        studioState.view === 'favorites'
          ? 'The ones that stay with you.'
          : 'Every feeling, a soundtrack.',
        `${studioState.view === 'favorites' ? getPlayableSongs().filter((s) => s.liked).length : getPlayableSongs().length} songs, all made here.`,
      ) +
      renderLibraryFilters() +
      /* HTML */ `
        <div id="song-results">${renderSongList(getFilteredSongs())}</div>
      `
    );
  return (
    intro(
      'YOUR PERSONAL MUSIC STUDIO',
      'Your sound starts here.',
      'A space to create, collect, and get lost in your own music.',
    ) + renderHomePage()
  );
}
function renderPageIntro(label, title, description) {
  return /* HTML */ `
    <div class="page-intro">
      <div>
        <div class="eyebrow">${label}</div>
        <h1>${title}</h1>
        ${
          description
            ? /* HTML */ `
                <p>${description}</p>
              `
            : ''
        }
      </div>
    </div>
  `;
}
