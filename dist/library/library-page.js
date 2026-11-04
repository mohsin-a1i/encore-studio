import { renderEmptyState } from '../app/empty-state.js';
import {
  studioState,
  findSongById,
  getSelectedPlaylist,
  getPlayableSongs,
} from '../app/browser-state.js';
import { renderIcon } from '../app/icons.js';
import { escapeHtml, formatPlaybackTime, getLyricsExcerpt } from '../app/text-helpers.js';
import { mediaUrl } from '../app/interface-helpers.js';
import { getSongGenres } from '../songs/song-genres.js';

export function renderHomePage() {
  return /* HTML */ `
    <section class="section">
      <div class="section-head">
        <div class="heading-stack">
          <h2>Your playlists</h2>
          <p>
            ${studioState.playlists.length}
            ${studioState.playlists.length === 1 ? 'collection' : 'collections'}
          </p>
        </div>
        <button class="text-button" data-action="new-playlist">
          ${renderIcon('plus', 'sm')}
          <span>New playlist</span>
        </button>
      </div>
      <div class="playlists-grid">
        ${studioState.playlists.length ? studioState.playlists.slice(0, 3).map(renderPlaylistCard).join('') : renderEmptyState({ title: 'No playlists yet', description: 'Give your songs a place to belong.', icon: 'library', action: { action: 'new-playlist', label: 'New playlist' } })}
      </div>
    </section>
    <section class="section">
      <div class="section-head">
        <div class="heading-stack">
          <h2>Fresh from the studio</h2>
          <p>Your latest creations</p>
        </div>
        <button class="text-button" data-action="nav" data-view="library">
          <span>View all</span>
          ${renderIcon('arrow', 'sm')}
        </button>
      </div>
      <div id="song-results">${renderSongList(getFilteredSongs().slice(0, 6))}</div>
    </section>
  `;
}
export function renderPlaylistCard(playlist) {
  return /* HTML */ `
    <button class="playlist-card" data-action="playlist" data-id="${escapeHtml(playlist.id)}">
      <img src="${mediaUrl(playlist.cover)}" alt="Cover art for ${escapeHtml(playlist.name)}" />
      <span class="playlist-card-copy heading-stack">
        <strong class="playlist-card-title">${escapeHtml(playlist.name)}</strong>
        <span class="playlist-card-description">
          ${escapeHtml(playlist.description || 'A collection of your own sounds.')}
        </span>
        <small>
          ${playlist.songIds.filter((id) => findSongById(id)?.audio).length} songs ·
          ${Math.round(playlist.songIds.reduce((t, id) => t + (findSongById(id)?.duration || 0), 0) / 60)}
          min
        </small>
      </span>
    </button>
  `;
}
export function getFilteredSongs() {
  let songs =
    studioState.view === 'favorites'
      ? getPlayableSongs().filter((song) => song.liked)
      : getPlayableSongs();
  if (studioState.view === 'playlist')
    songs = (getSelectedPlaylist()?.songIds || []).map(findSongById).filter((song) => song?.audio);
  if (studioState.filter !== 'All')
    songs = songs.filter((song) => getSongGenres(song).includes(studioState.filter));
  if (studioState.query)
    songs = songs.filter((song) =>
      ((song.title || '') + ' ' + getSongGenres(song).join(' '))
        .toLowerCase()
        .includes(studioState.query.toLowerCase()),
    );
  return songs;
}
export function renderLibraryFilters() {
  const favorites = studioState.view === 'favorites';
  const songs = favorites ? getPlayableSongs().filter((song) => song.liked) : getPlayableSongs();
  const genres = [...new Set(songs.flatMap(getSongGenres))];
  if (studioState.filter !== 'All' && !genres.includes(studioState.filter))
    studioState.filter = 'All';
  return /* HTML */ `
    <div class="library-toolbar" data-filter-view="${studioState.view}">
      <label class="collection-search library-search">
        ${renderIcon('search', 'sm')}
        <input
          id="library-search"
          type="search"
          placeholder="${favorites ? 'Search favorites…' : 'Search your library…'}"
          aria-label="${favorites ? 'Search favorite songs' : 'Search library songs'}"
          value="${escapeHtml(studioState.query)}"
        />
      </label>
      <div
        id="library-filters"
        class="library-filters"
        role="group"
        aria-label="Filter songs by genre"
      >
        ${['All', ...genres].map((genre) => `<button type="button" class="filter ${studioState.filter === genre ? 'active' : ''}" data-action="filter" data-value="${escapeHtml(genre)}" aria-pressed="${studioState.filter === genre}">${escapeHtml(genre)}</button>`).join('')}
      </div>
    </div>
  `;
}
export function getSongListQueue(element) {
  const table = element.closest('.songs-table');
  return table
    ? [...table.querySelectorAll('tbody tr[data-song-row]')].map((row) => row.dataset.id)
    : undefined;
}

export function renderSongList(songs) {
  if (!songs.length) {
    const searching = Boolean(studioState.query.trim()) || studioState.filter !== 'All';
    const playlist = studioState.view === 'playlist';
    const favorites = studioState.view === 'favorites';
    return renderEmptyState({
      title: searching
        ? 'No songs found'
        : favorites
          ? 'No favorites yet'
          : playlist
            ? 'No songs in this playlist'
            : 'No songs yet',
      description: searching
        ? 'Try another title or genre.'
        : favorites
          ? 'Save the songs you love to find them here.'
          : playlist
            ? 'Add a few songs to start your collection.'
            : 'Your finished songs will appear here.',
      icon: searching ? 'search' : favorites ? 'heart' : 'note',
      action: searching
        ? { action: 'clear-song-filters', label: 'Show all songs' }
        : favorites
          ? { action: 'nav', view: 'library', label: 'Browse library' }
          : playlist
            ? { action: 'add-songs', label: 'Add songs' }
            : { action: 'nav', view: 'create', label: 'Create a song' },
    });
  }
  return /* HTML */ `
    <div class="table-wrap">
      <table class="songs-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Song</th>
            <th class="hide-sm">Style</th>
            <th>${renderIcon('note', 'sm')}</th>
            <th class="hide-sm"></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${songs
            .map(
              (song, i) => /* HTML */ `
                <tr
                  class="${song.id === studioState.currentId ? 'active' : ''}"
                  data-song-row
                  data-action="start-song"
                  data-id="${escapeHtml(song.id)}"
                >
                  <td>
                    <button
                      class="row-play"
                      data-action="play"
                      data-id="${escapeHtml(song.id)}"
                      aria-label="${studioState.currentId === song.id && studioState.playing ? 'Pause' : 'Play'} ${escapeHtml(song.title)}"
                    >
                      ${studioState.currentId === song.id && studioState.playing ? renderIcon('pause') : i + 1}
                    </button>
                  </td>
                  <td>
                    <div class="song-cell">
                      <img
                        class="song-cover"
                        src="${mediaUrl(song.cover)}"
                        alt="${escapeHtml(song.title)} cover"
                      />
                      <div>
                        <button
                          class="song-name"
                          data-action="start-song"
                          data-id="${escapeHtml(song.id)}"
                          aria-label="Play ${escapeHtml(song.title)}"
                        >
                          ${escapeHtml(song.title)}
                        </button>
                        <small dir="auto">${escapeHtml(getLyricsExcerpt(song.lyrics))}</small>
                      </div>
                    </div>
                  </td>
                  <td class="hide-sm">
                    <div class="song-genres">
                      ${getSongGenres(song)
                        .map((genre) => `<span class="genre-pill">${escapeHtml(genre)}</span>`)
                        .join('')}
                    </div>
                  </td>
                  <td class="duration-count">${formatPlaybackTime(song.duration)}</td>
                  <td class="hide-sm">
                    <button
                      class="icon-button ${song.liked ? 'liked' : ''}"
                      data-action="like"
                      data-id="${escapeHtml(song.id)}"
                      aria-label="${song.liked ? 'Remove from' : 'Add to'} favorites"
                    >
                      ${renderIcon('heart', 'sm')}
                    </button>
                  </td>
                  <td>
                    <button
                      class="icon-button"
                      data-action="song"
                      data-id="${escapeHtml(song.id)}"
                      aria-label="Song options for ${escapeHtml(song.title)}"
                    >
                      ${renderIcon('more')}
                    </button>
                  </td>
                </tr>
              `,
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}
export function renderPlaylistPage() {
  const playlist = getSelectedPlaylist();
  if (!playlist)
    return renderEmptyState({
      title: 'Playlist not found',
      description: 'This collection is no longer available.',
      icon: 'library',
      action: { action: 'nav', view: 'home', label: 'Back to overview' },
    });
  return /* HTML */ `
    <section class="playlist-hero">
      <button
        type="button"
        class="icon-button playlist-delete-action"
        data-action="delete-playlist"
        aria-label="Delete playlist"
        title="Delete playlist"
      >
        ${renderIcon('trash', 'sm')}
      </button>
      <button
        class="icon-button"
        data-action="upload-cover"
        data-kind="playlist"
        data-id="${escapeHtml(playlist.id)}"
        aria-label="Change playlist cover"
      >
        <img src="${mediaUrl(playlist.cover)}" alt="${escapeHtml(playlist.name)} cover" />
      </button>
      <div class="playlist-identity-copy heading-stack">
        <div class="eyebrow">YOUR PLAYLIST</div>
        <div class="heading-stack playlist-hero-copy">
          <h1 dir="auto">${escapeHtml(playlist.name)}</h1>
          <div class="playlist-meta">
            <span>Made by you</span>
            <span>${playlist.songIds.filter((id) => findSongById(id)?.audio).length} songs</span>
            <span>
              ${Math.round(playlist.songIds.reduce((t, id) => t + (findSongById(id)?.duration || 0), 0) / 60)}
              minutes
            </span>
          </div>
        </div>
        ${playlist.description ? `<p dir="auto">${escapeHtml(playlist.description)}</p>` : ''}
        <div class="playlist-actions">
          <button class="button" data-action="play-playlist">
            ${renderIcon('play', 'sm')}
            <span>Play playlist</span>
          </button>
          <button class="button secondary" data-action="add-songs">
            ${renderIcon('plus', 'sm')}
            <span>Add songs</span>
          </button>
          <button class="button secondary" data-action="edit-playlist">
            ${renderIcon('edit', 'sm')}
            <span>Edit</span>
          </button>
        </div>
      </div>
    </section>
    <section class="section">
      <div id="song-results">${renderSongList(getFilteredSongs())}</div>
    </section>
  `;
}
