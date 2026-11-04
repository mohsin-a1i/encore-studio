import { readDevice, writeDevice } from '../app/device-state.js';
import { createExploreView } from '../explore/explore-session.js';
import { studioState, songEdits, audio } from '../app/browser-state.js';

export function selectProfileWorkspace(id) {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  songEdits.clear();
  studioState.editorSections.clear();
  Object.assign(studioState, {
    profileId: id,
    profile: studioState.profiles.find((item) => item.id === id) || {
      id,
      name: 'Guest',
    },
    songs: [],
    exploreSongs: [],
    explore: createExploreView(),
    exploreDraft: undefined,
    profilePreferences: { theme: 'magic', editorSections: {} },
    preferenceRevision: 0,
    playlists: [],
    deletedSongIds: [],
    selectedSongId: readDevice('song-id', null, id),
    draftRequestId: null,
    editorConflictId: null,
    deletedEditorId: null,
    draftTitle: '',
    draftStyle: '',
    draftLyrics: '',
    sampleUrl: '',
    sampleUpload: null,
    removeSample: false,
    referenceMode: 'link',
    composingSong: false,
    currentId: null,
    currentAudio: null,
    playing: false,
    queue: [],
    view: 'home',
    playlistId: null,
    query: '',
    studioQuery: '',
    studioFilter: 'all',
    filter: 'All',
    pending: false,
    modal: null,
    connected: false,
  });
  writeDevice('profile-id', id);
}
