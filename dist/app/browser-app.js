import { readDevice, writeDevice } from './device-state.js';
import { initializeMediaPairs } from './media-pairs.js';
import {
  configureProfilePreferences,
  setProfilePreference,
} from '../profiles/profile-preferences.js';
import { createDevicePlayback } from '../playback/device-playback.js';
import {
  studioState,
  app,
  audio,
  modalRoot,
  songEdits,
  getPlayableSongs,
  findSongById,
  getPlayingSong,
  getSelectedPlaylist,
} from './browser-state.js';
import { createRequestId } from './request-id.js';
import { renderIcon } from './icons.js';
import { createSongLink, getSharedSongId } from '../songs/song-links.js';
import { createProfileActions } from '../profiles/profile-actions.js';
import { escapeHtml, copyTextToClipboard } from './text-helpers.js';
import { mediaUrl, showToast } from './interface-helpers.js';
import { createStudioConnection } from './studio-connection.js';
import { getConnectionSnapshotKey, connectionServices } from '../settings/connection-status.js';
import { createAudioPlayer } from '../playback/audio-player.js';
import { initializeKeyboardVisibility } from '../playback/keyboard-visibility.js';
import { initializeFieldValidation, showFieldError } from './form-fields.js';
import { createExploreController } from '../explore/explore-controller.js';
import { refreshExplorePage } from '../explore/explore-page.js';
import { openExploreIdeaDialog } from '../explore/explore-idea-dialog.js';
import { captureDeck, animateDeck } from '../explore/deck-motion.js';
import { initializeExploreGestures } from '../explore/explore-gestures.js';
import { updateSeekProgress } from '../playback/seek-progress.js';
import { renderApplicationShell } from './shell-view.js';
import { studioSongGroups } from '../studio/song-collection.js';
import { openAutoCompleteDialog } from '../studio/auto-complete-dialog.js';
import { renderSongList, getFilteredSongs, getSongListQueue } from '../library/library-page.js';
import { refreshStudioPage } from '../studio/studio-page.js';
import { updateEditorControls } from '../studio/editor-view.js';
import { createEditorActions } from '../studio/editor-actions.js';
import { createEditorAutosave } from '../studio/editor-autosave.js';
import { encodeReferenceInput } from '../studio/reference-input.js';
import {
  clearReferenceSelection,
  allowGenerationWithReference,
  handleReferenceSourceChange,
  recordEditorInput,
} from '../studio/reference-controls.js';
import { refreshSettingsPage, updateThemeSettings } from '../settings/settings-page.js';
import { selectTheme, syncSongTheme, subscribeToTheme } from '../settings/color-themes.js';
import { updatePlaylistMembership } from '../library/playlist-membership.js';
import { initializeSongScrolling } from '../studio/collection-scrolling.js';
import {
  openDialog,
  closeDialog,
  openSongDetails,
  openPlaylistEditor,
  openPlaylistSelection,
  confirmSongDeletion,
} from '../library/library-dialogs.js';

initializeKeyboardVisibility();
initializeFieldValidation();
initializeMediaPairs(app, modalRoot);

const {
  requestStudio,
  startUpdates,
  connectStudio,
  refreshLibrary,
  refreshDependencyStatus,
  retryServiceConnection,
} = createStudioConnection({
  syncPlaybackWithLibrary,
});
const { startSong, playSong, togglePlayback, playNextSong, playPreviousSong, syncMediaSession } =
  createAudioPlayer({
    renderApplication,
    onSourceChange: () => devicePlayback.sync(),
    onAdvance: (direction) => direction === 1 && explore.advance(),
  });
const explore = createExploreController({
  state: studioState,
  audio,
  requestStudio,
  refreshLibrary,
  startSong,
  render: () => {
    if (studioState.view === 'explore') refreshExplorePage();
  },
  notify: showToast,
  onAutoSkip: (id) => {
    if (document.visibilityState === 'hidden') return;
    const card = studioState.view === 'explore' ? app.querySelector('[data-explore-card]') : null;
    if (card?.dataset.id === id) void exploreGestures.animateExit('left', card);
  },
});
configureProfilePreferences(requestStudio);
const devicePlayback = createDevicePlayback({
  state: studioState,
  audio,
  requestStudio,
  findSong: findSongById,
});
const exploreGestures = initializeExploreGestures(
  app,
  explore.vote,
  () => studioState.explore.busy,
  () => {
    if (studioState.view === 'explore') refreshExplorePage();
  },
);
const { scheduleEditorSave, flushEditorSave, resolveEditorConflict, recoverEditor } =
  createEditorAutosave({
    requestStudio,
    onSaved: refreshStudioPage,
    onError: (error) => showToast(error.message),
  });
const { startEditorGeneration, startAutoCompletion } = createEditorActions({
  requestStudio,
  refreshLibrary,
  renderApplication,
  flushEditorSave,
});
const { handleProfileAction, saveProfile } = createProfileActions({
  beforeSwitch: () => flushEditorSave(document.querySelector('#song-editor-form')),
  requestStudio,
  refreshLibrary,
  renderApplication,
});

async function loadReferenceAudio(form) {
  if (!form || form._preparing) return;
  form._preparing = true;
  form._referenceError = '';
  updateEditorControls(form);
  const profileId = studioState.profileId;
  try {
    await flushEditorSave(form);
    let songId = form.dataset.id;
    if (!songId) {
      const reference = await encodeReferenceInput(
        form.elements.sampleUrl?.value || '',
        studioState,
      );
      const draft = await requestStudio('songs', {
        method: 'POST',
        headers: { 'X-Request-Id': createRequestId() },
        body: JSON.stringify({
          kind: 'draft',
          title: form.elements.title?.value || '',
          style: form.elements.style?.value || '',
          lyrics: form.elements.lyrics?.value || '',
          ...reference,
        }),
      });
      if (profileId !== studioState.profileId) return;
      songId = draft.id;
      studioState.selectedSongId = songId;
      Object.assign(studioState, {
        draftTitle: '',
        draftStyle: '',
        draftLyrics: '',
        sampleUrl: '',
        sampleUpload: null,
        removeSample: false,
      });
      writeDevice('song-id', songId, studioState.profileId);
      await refreshLibrary();
      renderApplication();
    }
    await requestStudio(`songs/${songId}/reference`, {
      method: 'POST',
      headers: { 'X-Request-Id': createRequestId() },
      body: '{}',
    });
    if (profileId !== studioState.profileId) return;
    await refreshLibrary();
    renderApplication();
  } catch (error) {
    if (profileId === studioState.profileId) {
      const message = document.querySelector('#song-editor-form [data-reference-error]');
      if (message) {
        const currentForm = message.closest('form');
        currentForm._referenceError = error.message;
        showFieldError(
          currentForm.elements.sampleUrl.disabled
            ? currentForm.elements.sampleUpload
            : currentForm.elements.sampleUrl,
          error.message,
        );
      } else showToast(error.message);
    }
  } finally {
    form._preparing = false;
    if (profileId === studioState.profileId && form.isConnected) updateEditorControls(form);
  }
}
let coverTarget;
let pendingSharedSongId = getSharedSongId();
const views = [
  'home',
  'create',
  'explore',
  'library',
  'favorites',
  'playlists',
  'playlist',
  'settings',
];
subscribeToTheme(updateThemeSettings);

function navigate(view, id) {
  studioState.navigationOpen = false;
  studioState.view = view;
  studioState.playlistId = id || null;
  studioState.filter = 'All';
  studioState.query = '';
  closeDialog();
  renderApplication();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  location.hash = view === 'playlist' ? 'playlist/' + id : view;
  if (view === 'settings')
    document.querySelector('#settings-title')?.focus({ preventScroll: true });
}
function renderApplication() {
  void syncSongTheme(getPlayingSong());
  const focus = document.activeElement?.id;
  const exploreResults =
    studioState.view === 'explore' ? app.querySelector('#explore-results') : null;
  const previousDeck = studioState.view === 'explore' ? new Map() : captureDeck(app);
  app.innerHTML = renderApplicationShell();
  if (exploreResults) app.querySelector('#explore-results')?.replaceWith(exploreResults);
  if (studioState.view === 'explore') refreshExplorePage();
  else animateDeck(app, previousDeck);
  initializeSongScrolling();
  if (['studio-search', 'library-search'].includes(focus))
    document.querySelector('#' + focus)?.focus();
}
function setNavigationOpen(open) {
  studioState.navigationOpen = open;
  const sidebar = document.querySelector('#main-navigation');
  const scrim = document.querySelector('.nav-scrim');
  const toggle = document.querySelector('.navigation-toggle');
  if (sidebar) sidebar.dataset.open = String(open);
  if (scrim) scrim.hidden = !open;
  toggle?.setAttribute('aria-expanded', String(open));
  if (open) {
    requestAnimationFrame(() => {
      if (studioState.navigationOpen) sidebar?.querySelector('.navigation-close')?.focus();
    });
  } else toggle?.focus({ preventScroll: true });
}
async function handleClick(event) {
  const actionElement = event.target.closest('[data-action]');
  if (!actionElement) {
    if (event.target.classList.contains('modal-overlay')) closeDialog();
    return;
  }
  event.preventDefault();
  const { action, id, view, value, kind } = actionElement.dataset;
  try {
    if (action === 'profiles' || action.startsWith('profile-')) {
      await handleProfileAction(action, id);
      return;
    }
    switch (action) {
      case 'toggle-navigation':
        setNavigationOpen(!studioState.navigationOpen);
        break;
      case 'close-navigation':
        setNavigationOpen(false);
        break;
      case 'clear-song-filters':
        studioState.query = '';
        studioState.filter = 'All';
        renderApplication();
        break;
      case 'nav':
        navigate(view);
        break;
      case 'explore-idea':
        openExploreIdeaDialog();
        break;
      case 'explore-save':
        await exploreGestures.decide('right');
        break;
      case 'explore-skip':
        await exploreGestures.decide('left');
        break;
      case 'explore-retry':
        explore.retry();
        break;
      case 'playlist':
        navigate('playlist', id);
        break;
      case 'filter':
        studioState.filter = value;
        renderApplication();
        document
          .querySelector('#library-filters .filter[aria-pressed="true"]')
          ?.focus({ preventScroll: true });
        break;
      case 'start-song':
        await startSong(id, getSongListQueue(actionElement));
        break;
      case 'play':
        await playSong(id, getSongListQueue(actionElement));
        break;
      case 'player-expand': {
        studioState.playerExpanded = !studioState.playerExpanded;
        writeDevice('player-expanded', studioState.playerExpanded);
        const expanded = studioState.playerExpanded;
        actionElement.closest('.player').dataset.expanded = String(expanded);
        actionElement.setAttribute('aria-expanded', String(expanded));
        actionElement.setAttribute(
          'aria-label',
          expanded ? 'Collapse player' : 'Expand player controls',
        );
        actionElement.innerHTML = renderIcon(expanded ? 'chevron-down' : 'chevron-up');
        break;
      }
      case 'toggle':
        togglePlayback();
        break;
      case 'next':
        playNextSong();
        break;
      case 'previous':
        playPreviousSong();
        break;
      case 'shuffle':
        studioState.shuffle = !studioState.shuffle;
        writeDevice('shuffle', studioState.shuffle);
        renderApplication();
        document.querySelector('[data-action=shuffle]')?.focus({ preventScroll: true });
        break;
      case 'repeat':
        studioState.repeat = !studioState.repeat;
        writeDevice('repeat', studioState.repeat);
        renderApplication();
        document.querySelector('[data-action=repeat]')?.focus({ preventScroll: true });
        break;
      case 'like': {
        const s = findSongById(id);
        const updated = await requestStudio('songs/' + id, {
          method: 'PATCH',
          body: JSON.stringify({ liked: !s.liked }),
        });
        Object.assign(s, updated);
        renderApplication();
        break;
      }
      case 'song':
        openSongDetails(id);
        break;
      case 'share-song':
        await copyTextToClipboard(createSongLink(id, studioState.profileId));
        showToast('Song link copied.');
        break;
      case 'download-song':
        location.assign(
          mediaUrl('api/download/' + id + '?profile=' + encodeURIComponent(studioState.profileId)),
        );
        break;
      case 'current-lyrics':
        openSongDetails(getPlayingSong()?.id || getPlayableSongs()[0]?.id);
        break;
      case 'close-modal':
        closeDialog();
        break;
      case 'new-playlist':
        openPlaylistEditor(
          false,
          studioState.modal?.kind === 'add-to-playlist' ? studioState.modal.id : null,
        );
        break;
      case 'edit-playlist':
        openPlaylistEditor(true);
        break;
      case 'add-songs':
        openPlaylistSelection('add-songs', studioState.playlistId);
        break;
      case 'add-to-playlist':
        openPlaylistSelection(action, id);
        break;
      case 'play-playlist': {
        const ids = (getSelectedPlaylist()?.songIds || []).filter((id) => findSongById(id)?.audio);
        if (ids.length) await playSong(ids[0], ids);
        else showToast('Add a few songs first.');
        break;
      }
      case 'retry-connection': {
        const service = actionElement.dataset.service;
        if (studioState.connectionChecks.has(service)) break;
        const name = connectionServices.find(({ id }) => id === service)?.name;
        if (!name) break;
        studioState.connectionChecks.add(service);
        refreshSettingsPage();
        try {
          const connected = await retryServiceConnection(service);
          showToast(connected ? `${name} connection verified.` : `${name} is not connected.`);
        } finally {
          studioState.connectionChecks.delete(service);
          if (studioState.view === 'settings') refreshSettingsPage();
          else renderApplication();
        }
        break;
      }
      case 'upload-cover':
        if (!studioState.connected) throw new Error('Connect your local studio to change artwork.');
        coverTarget = { kind, id };
        document.querySelector('#cover-file').click();
        break;
      case 'copy-lyrics':
        await copyTextToClipboard(findSongById(id)?.lyrics || '');
        showToast('Lyrics copied.');
        break;
      case 'edit-song': {
        studioState.composingSong = false;
        studioState.selectedSongId = id;
        writeDevice('song-id', id, studioState.profileId);
        const switchingView = studioState.view !== 'create' || Boolean(studioState.modal);
        if (switchingView) {
          navigate('create');
          document
            .querySelector('#song-editor-form input[name="title"]')
            ?.focus({ preventScroll: true });
        } else refreshStudioPage();
        document.querySelector('#studio-editor')?.scrollIntoView({
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
          block: 'nearest',
        });
        break;
      }
      case 'studio-filter':
        if (value !== 'all' && !studioSongGroups.some((group) => group.id === value)) break;
        studioState.studioFilter = value;
        refreshStudioPage();
        break;
      case 'studio-reset':
        studioState.studioQuery = '';
        studioState.studioFilter = 'all';
        refreshStudioPage();
        document.querySelector('#studio-search')?.focus();
        break;
      case 'begin-song':
      case 'new-song':
        if (studioState.pending) break;
        studioState.composingSong = true;
        studioState.draftRequestId = createRequestId();
        Object.assign(studioState, {
          draftTitle: '',
          draftStyle: '',
          draftLyrics: '',
          sampleUrl: '',
          sampleUpload: null,
        });
        studioState.selectedSongId = null;
        writeDevice('song-id', null, studioState.profileId);
        navigate('create');
        document.querySelector('#song-editor-form input[name=title]')?.focus();
        break;
      case 'recover-deleted-editor':
        recoverEditor(actionElement.closest('#song-editor-form'), studioState.deletedEditorId);
        refreshStudioPage();
        break;
      case 'recover-editor':
        recoverEditor(actionElement.closest('#song-editor-form'));
        break;
      case 'reload-editor':
      case 'reapply-editor':
        await refreshLibrary();
        await resolveEditorConflict(
          actionElement.closest('#song-editor-form'),
          action === 'reapply-editor',
        );
        renderApplication();
        break;
      case 'auto-complete':
        if (allowGenerationWithReference(actionElement.closest('form')))
          openAutoCompleteDialog(actionElement.closest('form'));
        break;
      case 'cancel-song':
        actionElement.disabled = true;
        await requestStudio('songs/' + id + '/cancel', {
          method: 'POST',
          body: '{}',
        });
        await refreshLibrary();
        renderApplication();
        showToast('Generation stopped.');
        break;
      case 'clear-reference':
        clearReferenceSelection(actionElement.closest('form'));
        scheduleEditorSave(actionElement.closest('form'));
        break;
      case 'prepare-reference': {
        await loadReferenceAudio(actionElement.closest('#song-editor-form'));
        break;
      }
      case 'copy-song': {
        actionElement.disabled = true;
        const copy = await requestStudio('songs/' + id + '/copy', {
          method: 'POST',
          headers: { 'X-Request-Id': createRequestId() },
          body: '{}',
        });
        studioState.composingSong = false;
        studioState.selectedSongId = copy.id;
        writeDevice('song-id', copy.id, studioState.profileId);
        await refreshLibrary();
        renderApplication();
        showToast('Your copy is ready to make your own.');
        break;
      }
      case 'remove-song-from-playlist': {
        const context = studioState.modal;
        const playlist = studioState.playlists.find(
          (item) => item.id === actionElement.dataset.playlistId,
        );
        if (!playlist) break;
        actionElement.disabled = true;
        try {
          await updatePlaylistMembership(requestStudio, playlist, id, false);
          await refreshLibrary();
          renderApplication();
          if (studioState.modal === context && context?.kind === 'song') {
            openSongDetails(id);
            modalRoot.querySelector('[data-action="add-to-playlist"]')?.focus();
          }
          showToast('Removed from ' + playlist.name + '.');
        } finally {
          actionElement.disabled = false;
        }
        break;
      }
      case 'delete-song':
        confirmSongDeletion(id);
        break;
      case 'confirm-delete-song': {
        actionElement.disabled = true;
        actionElement.textContent = 'Deleting…';
        try {
          const result = await requestStudio('songs/' + id, {
            method: 'DELETE',
            body: JSON.stringify({ confirmation: id }),
          });
          studioState.songs = studioState.songs.filter((s) => s.id !== id);
          studioState.deletedSongIds = [...new Set([...(studioState.deletedSongIds || []), id])];
          songEdits.delete(id);
          if (studioState.selectedSongId === id) {
            studioState.selectedSongId = null;
            writeDevice('song-id', null, studioState.profileId);
          }
          syncPlaybackWithLibrary();
          closeDialog();
          await refreshLibrary();
          renderApplication();
          showToast(
            result.cleanupPending
              ? 'Song deleted. Saved files will be cleaned up shortly.'
              : 'Song deleted completely.',
          );
        } finally {
          actionElement.disabled = false;
          actionElement.textContent = 'Delete song completely';
        }
        break;
      }
      case 'delete-playlist': {
        const p = getSelectedPlaylist();
        openDialog(
          'Delete this playlist?',
          /* HTML */ `
            <p class="help">
              “${escapeHtml(p.name)}” will be removed. Its songs stay in your library.
            </p>
          `,
          /* HTML */ `
            <button class="button secondary" data-action="close-modal">Keep playlist</button>
            <button
              class="button danger"
              data-action="confirm-delete"
              data-id="${escapeHtml(p.id)}"
            >
              Delete playlist
            </button>
          `,
        );
        break;
      }
      case 'confirm-delete':
        await requestStudio('playlists/' + id, { method: 'DELETE' });
        await refreshLibrary();
        navigate('playlists');
        showToast('Playlist removed.');
        break;
    }
  } catch (error) {
    if ('disabled' in actionElement) actionElement.disabled = false;
    showToast(error.message);
  }
}
function handleInput(event) {
  if (event.target.id === 'explore-idea') {
    studioState.exploreDraft = event.target.value;
    writeDevice('explore-draft', event.target.value, studioState.profileId);
  }
  recordEditorInput(event.target);
  if (['title', 'style', 'lyrics', 'sampleUrl'].includes(event.target.name))
    scheduleEditorSave(event.target.closest('#song-editor-form'));
  if (event.target.id === 'studio-search') {
    studioState.studioQuery = event.target.value;
    refreshStudioPage();
  }
  if (event.target.id === 'library-search') {
    studioState.query = event.target.value;
    const target = document.querySelector('#song-results');
    if (target)
      target.innerHTML = renderSongList(
        studioState.view === 'home' ? getFilteredSongs().slice(0, 6) : getFilteredSongs(),
      );
  }
  if (event.target.id === 'seek') {
    updateSeekProgress(event.target);
    if (audio.src) audio.currentTime = Number(event.target.value);
  }
  if (event.target.id === 'volume') {
    updateSeekProgress(event.target);
    studioState.volume = Number(event.target.value);
    audio.volume = studioState.volume;
    writeDevice('volume', studioState.volume);
  }
}
async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;
  try {
    if (form.id === 'explore-form') {
      const idea = String(new FormData(form).get('idea') || '').trim();
      if (!idea) {
        form.elements.idea.value = '';
        form.reportValidity();
        return;
      }
      if (studioState.explore.busy) return;
      closeDialog();
      await explore.start(idea);
      if (studioState.explore.idea === idea)
        writeDevice('explore-draft', null, studioState.profileId);
      return;
    }
    if (form.id === 'profile-form') return await saveProfile(form);
    if (form.id === 'auto-complete-form') return await startAutoCompletion(form);
    if (form.id === 'song-editor-form') {
      if (event.submitter?.value === 'audio') await startEditorGeneration(form, 'audio');
      return;
    }
    if (form.id === 'playlist-form') {
      const button = form.querySelector('button:not([type=button]):last-of-type');
      if (button) button.disabled = true;
      const data = Object.fromEntries(new FormData(form));
      const context = studioState.modal;
      const id = context?.id;
      if (id) data.baseRevision = Number(form.dataset.baseRevision || 0);
      const p = await requestStudio('playlists' + (id ? '/' + id : ''), {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(data),
      });
      context.id = p.id;
      if (context.songId) await updatePlaylistMembership(requestStudio, p, context.songId, true);
      await refreshLibrary();
      if (context.songId) {
        renderApplication();
        if (studioState.modal === context) openSongDetails(context.songId);
        showToast('Playlist saved. Song added.');
      } else {
        navigate('playlist', p.id);
        showToast(id ? 'Playlist updated.' : 'Your new playlist is ready.');
      }
      return;
    }
    if (form.id === 'selection-form') {
      const button = form.querySelector('button:not([type=button]):last-of-type');
      if (button) button.disabled = true;
      const ids = new FormData(form).getAll('selection');
      if (studioState.modal.kind === 'add-songs') {
        await requestStudio('playlists/' + studioState.modal.id, {
          method: 'PATCH',
          body: JSON.stringify({
            songIds: ids,
            baseRevision: studioState.modal.revision || 0,
          }),
        });
      }
      await refreshLibrary();
      closeDialog();
      renderApplication();
      showToast('Playlist saved.');
    }
  } catch (error) {
    studioState.pending = false;
    form.querySelectorAll('button').forEach((b) => (b.disabled = false));
    if (['profile-form', 'playlist-form'].includes(form.id) && [400, 409].includes(error.status)) {
      if (showFieldError(form.elements.name, error.message)) return;
    }
    showToast(error.message);
  }
}

// These roots survive rendering; delegation stays inside each app region.
for (const root of [app, modalRoot]) {
  root.addEventListener('click', handleClick);
  root.addEventListener('submit', handleSubmit);
}
app.addEventListener('input', handleInput);
modalRoot.addEventListener('input', (event) => {
  if (event.target.id === 'explore-idea') handleInput(event);
});
app.addEventListener(
  'toggle',
  (event) => {
    const section = event.target;
    const form = section.closest?.('#song-editor-form');
    if (!form || !section.dataset.editorSection) return;
    const key = form.dataset.id || 'new';
    if (
      (studioState.editorSections.get(key)?.[section.dataset.editorSection] ?? true) ===
      section.open
    )
      return;
    studioState.editorSections.set(key, {
      ...studioState.editorSections.get(key),
      [section.dataset.editorSection]: section.open,
    });
    void setProfilePreference('editorSections', Object.fromEntries(studioState.editorSections));
  },
  true,
);
app.addEventListener('change', (event) => {
  if (handleReferenceSourceChange(event, (form) => void loadReferenceAudio(form))) return;
  if (event.target.matches('input[name="studio-theme"]')) void selectTheme(event.target.value);
});
modalRoot.addEventListener('change', async (event) => {
  const input = event.target.closest('[data-playlist-membership]');
  const context = studioState.modal;
  if (!input || context?.kind !== 'add-to-playlist') return;
  const playlist = studioState.playlists.find((item) => item.id === input.dataset.playlistId);
  if (!playlist) return;
  const previous = playlist.songIds.includes(input.dataset.songId);
  const focused = document.activeElement === input;
  context.pending = (context.pending || 0) + 1;
  input.disabled = true;
  const updateControls = (message) => {
    if (studioState.modal !== context) return;
    modalRoot.querySelectorAll('[data-playlist-management-action]').forEach((button) => {
      button.disabled = context.pending > 0;
    });
    const status = modalRoot.querySelector('[data-playlist-save-status]');
    if (status) status.textContent = context.pending ? 'Saving…' : message;
  };
  updateControls('');
  let message = 'Changes saved.';
  try {
    const updated = await updatePlaylistMembership(
      requestStudio,
      playlist,
      input.dataset.songId,
      input.checked,
    );
    const currentPlaylist = studioState.playlists.find((item) => item.id === playlist.id);
    if (currentPlaylist) Object.assign(currentPlaylist, updated);
    renderApplication();
  } catch (error) {
    input.checked = previous;
    message = 'Could not save this change. Please try again.';
    showToast(error.message);
  } finally {
    context.pending--;
    input.disabled = false;
    updateControls(message);
    if (studioState.modal === context && focused && document.activeElement === document.body)
      input.focus();
  }
});
app.addEventListener(
  'play',
  (event) => {
    if (event.target.matches('[data-sample-preview]')) audio.pause();
  },
  true,
);
app.addEventListener('focusout', async (event) => {
  const input = event.target;
  const form = input.closest('#song-editor-form');
  if (!form || !['title', 'style', 'lyrics', 'sampleUrl'].includes(input.name)) return;
  try {
    await flushEditorSave(form);
  } catch (error) {
    showToast(error.message);
  }
});
app.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.matches('#song-editor-form input'))
    event.preventDefault();
});

document.querySelector('#cover-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file || !coverTarget) return;
  try {
    if (file.size > 3_000_000) throw new Error('Choose a cover smaller than 3 MB.');
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await requestStudio(`cover/${coverTarget.kind}/${coverTarget.id}`, {
      method: 'POST',
      body: JSON.stringify({ image: data }),
    });
    await refreshLibrary();
    renderApplication();
    if (
      coverTarget.kind === 'song' &&
      studioState.modal?.kind === 'song' &&
      studioState.modal.id === coverTarget.id
    )
      openSongDetails(coverTarget.id);
    showToast('Cover art updated.');
  } catch (error) {
    showToast(error.message);
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (modalRoot.firstChild) closeDialog();
    else if (studioState.navigationOpen) setNavigationOpen(false);
  }
  if (event.key === 'Tab' && studioState.navigationOpen && !modalRoot.firstChild) {
    const items = [...document.querySelectorAll('#main-navigation button')].filter(
      (button) => !button.disabled && button.getClientRects().length,
    );
    if (event.shiftKey && document.activeElement === items[0]) {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
      event.preventDefault();
      items[0]?.focus();
    }
  }
  if (event.key === 'Tab' && modalRoot.firstChild) {
    const items = [...modalRoot.querySelectorAll('button,a,input,select,textarea')].filter(
      (actionElement) =>
        !actionElement.disabled &&
        actionElement.tabIndex !== -1 &&
        actionElement.getClientRects().length,
    );
    if (event.shiftKey && document.activeElement === items[0]) {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
      event.preventDefault();
      items[0]?.focus();
    }
  }
  if (
    event.code === 'Space' &&
    !/INPUT|TEXTAREA|SELECT|BUTTON|PRE/.test(document.activeElement.tagName) &&
    !modalRoot.firstChild
  ) {
    event.preventDefault();
    togglePlayback();
  }
});
async function initializeApplication() {
  const hash = location.hash.slice(1).split('/');
  if (views.includes(hash[0])) {
    studioState.view = hash[0];
    studioState.playlistId = hash[0] === 'playlist' ? hash[1] || null : null;
  }
  renderApplication();
  await connectStudio();
  renderApplication();
  await openSharedSong();
  await refreshDependencyStatus();
  renderApplication();
}
async function openSharedSong() {
  if (!pendingSharedSongId || !studioState.connected) return;
  const id = pendingSharedSongId;
  pendingSharedSongId = null;
  if (!findSongById(id)) {
    showToast('This song is no longer available.');
    return;
  }
  openSongDetails(id);
  await startSong(id);
}
window.addEventListener('hashchange', () => {
  pendingSharedSongId = getSharedSongId();
  if (pendingSharedSongId) {
    void openSharedSong();
    return;
  }
  const [view, id] = location.hash.slice(1).split('/');
  if (!views.includes(view)) return;
  const playlistId = view === 'playlist' ? id || null : null;
  if (studioState.view !== view || studioState.playlistId !== playlistId)
    navigate(view, playlistId);
});
await initializeApplication();
let lastConnectionSnapshot = getConnectionSnapshotKey();
startUpdates(() => {
  const connectionChanged = lastConnectionSnapshot !== getConnectionSnapshotKey();
  lastConnectionSnapshot = getConnectionSnapshotKey();
  if (connectionChanged) renderApplication();
  else if (studioState.view === 'settings') refreshSettingsPage();
  else if (studioState.view === 'create') refreshStudioPage();
  else if (studioState.view === 'explore') refreshExplorePage();
  else renderApplication();
  void openSharedSong();
});
window.addEventListener('online', () => void connectStudio());

function syncPlaybackWithLibrary() {
  devicePlayback.restore();
  if (studioState.exploreDraft === undefined)
    studioState.exploreDraft = readDevice('explore-draft', undefined, studioState.profileId);
  studioState.queue = studioState.queue.filter((id) => findSongById(id)?.audio);
  if (studioState.currentId && !findSongById(studioState.currentId)?.audio) {
    if (studioState.playing) showToast('This song was deleted.');
    studioState.currentId = null;
    studioState.currentAudio = null;
    devicePlayback.clear();
    studioState.playing = false;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  const song = getPlayingSong();
  if (song && studioState.currentAudio !== song.audio) {
    audio.pause();
    studioState.playing = false;
    studioState.currentAudio = song.audio;
    audio.src = mediaUrl(song.audio);
    audio.load();
  }
  if (studioState.modal?.kind === 'song' && !findSongById(studioState.modal.id)?.audio)
    closeDialog();
  void syncSongTheme(getPlayingSong());
  syncMediaSession();
  explore.sync();
  devicePlayback.sync();
}
