import { readDevice } from './device-state.js';
import { createExploreView } from '../explore/explore-session.js';

export const app = document.querySelector('#app'),
  modalRoot = document.querySelector('#modal-root'),
  audio = document.querySelector('#audio');
export const studioState = {
  profileId:
    new URL(location.href || location.origin).searchParams.get('profile') ||
    readDevice('profile-id') ||
    'guest',
  profile: { id: 'guest', name: 'Guest' },
  profiles: [],
  songs: [],
  exploreSongs: [],
  explore: createExploreView(),
  exploreDraft: undefined,
  profilePreferences: { theme: 'magic', editorSections: {} },
  preferenceRevision: 0,
  playlists: [],
  selectedSongId: readDevice(
    'song-id',
    null,
    new URL(location.href || location.origin).searchParams.get('profile') ||
      readDevice('profile-id', 'guest'),
  ),
  draftTitle: '',
  draftStyle: '',
  draftLyrics: '',
  composingSong: false,
  sampleUrl: '',
  sampleUpload: null,
  referenceMode: 'link',
  editorSections: new Map(),
  removeSample: false,
  view: 'home',
  playlistId: null,
  query: '',
  studioQuery: '',
  studioFilter: 'all',
  filter: 'All',
  connected: false,
  health: {},
  connectionChecks: new Set(),
  currentId: null,
  currentAudio: null,
  playing: false,
  playerExpanded: readDevice('player-expanded', false),
  navigationOpen: false,
  queue: [],
  shuffle: readDevice('shuffle', false),
  repeat: readDevice('repeat', false),
  volume: Math.max(0, Math.min(1, Number(readDevice('volume', 0.7)) || 0)),
  modal: null,
  pending: false,
};
export const studioOrigin = location.origin;
export const songEdits = new Map();
export function reconcileSongEdits(song) {
  const edits = songEdits.get(song.id);
  if (!edits) return;
  if (
    edits._lyricsJobId === song.job?.id &&
    song.job?.kind === 'lyrics' &&
    song.job.outcome === 'complete'
  ) {
    songEdits.delete(song.id);
    return;
  }
  for (const key of [
    'title',
    'style',
    'lyrics',
    'sampleUrl',
    'sampleUpload',
    'removeSample',
    'referenceMode',
  ])
    if (edits[key] === (song[key] ?? '')) delete edits[key];
  if (
    ![
      'title',
      'style',
      'lyrics',
      'sampleUrl',
      'sampleUpload',
      'removeSample',
      'referenceMode',
    ].some((key) => edits[key] !== undefined)
  )
    songEdits.delete(song.id);
}
export const getPlayableSongs = () => studioState.songs.filter((song) => song.audio);
export const findSongById = (id) =>
    studioState.songs.find((song) => song.id === id) ||
    studioState.exploreSongs.find((song) => song.id === id),
  getPlayingSong = () => findSongById(studioState.currentId),
  getSelectedPlaylist = () =>
    studioState.playlists.find((playlist) => playlist.id === studioState.playlistId);
