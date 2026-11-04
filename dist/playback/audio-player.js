import { studioState, audio, findSongById, getPlayableSongs } from '../app/browser-state.js';
import { mediaUrl, showToast } from '../app/interface-helpers.js';
import { syncSongTheme } from '../settings/color-themes.js';
import { createMediaSessionControls } from './media-session.js';
import { updatePlaybackControls, updatePlaybackProgress } from './player-interface.js';

export function createAudioPlayer({
  renderApplication,
  onSourceChange = () => {},
  onAdvance = () => false,
}) {
  const subscriptions = [];
  function listen(target, event, handler) {
    if (!target.addEventListener) return;
    target.addEventListener(event, handler);
    subscriptions.push(() => target.removeEventListener?.(event, handler));
  }
  let sourceVersion = 0;
  async function playCurrentSource() {
    const version = sourceVersion;
    try {
      await audio.play();
    } catch (error) {
      if (version !== sourceVersion || ['NotAllowedError', 'AbortError'].includes(error.name))
        return;
      showToast('This song could not be played. Check your studio connection.');
    }
    if (version === sourceVersion) updatePlayer();
  }
  async function startSong(id, queue, { restart = false } = {}) {
    const song = findSongById(id);
    if (!song?.audio) return;
    const sameSource = studioState.currentId === id && studioState.currentAudio === song.audio;
    if (queue?.length || !sameSource) {
      studioState.queue = (
        queue?.length ? queue : getPlayableSongs().map((song) => song.id)
      ).filter((songId) => findSongById(songId)?.audio);
      if (!studioState.queue.includes(id)) studioState.queue.unshift(id);
    }
    if (sameSource) {
      if (restart) audio.currentTime = 0;
      await resumePlayback();
      return;
    }
    studioState.currentId = id;
    studioState.currentAudio = song.audio;
    const version = ++sourceVersion;
    audio.src = mediaUrl(song.audio);
    audio.volume = studioState.volume;
    mediaSession.sync();
    // Start playback in the media event/user activation, before any UI or network work.
    const playing = playCurrentSource();
    onSourceChange();
    await playing;
    if (version === sourceVersion) renderPlayer();
  }
  function playSong(id, queue) {
    if (studioState.currentId === id && studioState.currentAudio === findSongById(id)?.audio)
      return togglePlayback();
    return startSong(id, queue);
  }
  function resumePlayback() {
    if (!findSongById(studioState.currentId)?.audio) return startSong(getPlayableSongs()[0]?.id);
    if (audio.paused || audio.ended) return playCurrentSource();
  }
  function togglePlayback() {
    if (audio.paused || !studioState.currentId) return resumePlayback();
    else audio.pause();
  }
  function playPreviousSong() {
    return playNextSong(-1);
  }
  function playNextSong(direction = 1, options = { source: 'ui' }) {
    if (onAdvance(direction, options)) return;
    if (options.ended && studioState.repeat)
      return startSong(studioState.currentId, studioState.queue, { restart: true });
    const songIds = studioState.queue.length
      ? studioState.queue.filter((id) => findSongById(id)?.audio)
      : getPlayableSongs().map((song) => song.id);
    if (!songIds.length) return;
    const currentIndex = songIds.indexOf(studioState.currentId);
    const index =
      studioState.shuffle && songIds.length > 1
        ? (Math.max(0, currentIndex) + 1 + Math.floor(Math.random() * (songIds.length - 1))) %
          songIds.length
        : currentIndex < 0
          ? direction < 0
            ? songIds.length - 1
            : 0
          : (currentIndex + direction + songIds.length) % songIds.length;
    return startSong(songIds[index], songIds, { restart: true });
  }
  const mediaSession = createMediaSessionControls({
    audio,
    getSong: () => findSongById(studioState.currentId),
    play: resumePlayback,
    pause: () => audio.pause(),
    next: () => playNextSong(1, { source: 'media-session' }),
    previous: () => playNextSong(-1, { source: 'media-session' }),
    coverUrl: mediaUrl,
  });
  let renderPending = false;
  function updatePlayer() {
    mediaSession.sync();
    if (document.visibilityState === 'hidden') {
      renderPending = true;
      return;
    }
    updatePlaybackControls();
  }
  function renderPlayer() {
    if (document.visibilityState === 'hidden') {
      renderPending = true;
      return;
    }
    renderApplication();
    renderPending = false;
  }
  function restoreNativeControls() {
    mediaSession.bind();
    if (document.visibilityState !== 'hidden') {
      if (renderPending) renderPlayer();
      updatePlayer();
      updatePlaybackProgress();
      void syncSongTheme(findSongById(studioState.currentId));
    }
  }
  listen(document, 'visibilitychange', restoreNativeControls);
  listen(globalThis, 'pageshow', restoreNativeControls);
  listen(globalThis, 'focus', restoreNativeControls);
  listen(audio, 'play', () => {
    if (document.visibilityState !== 'hidden')
      void syncSongTheme(findSongById(studioState.currentId));
    document.querySelectorAll('[data-sample-preview]').forEach((preview) => preview.pause());
    studioState.playing = true;
    updatePlayer();
  });
  listen(audio, 'pause', () => {
    studioState.playing = false;
    updatePlayer();
  });
  listen(audio, 'timeupdate', () => {
    if (document.visibilityState !== 'hidden') updatePlaybackProgress();
    mediaSession.updatePosition();
  });
  for (const event of ['loadedmetadata', 'durationchange', 'seeked', 'ratechange', 'emptied'])
    listen(audio, event, mediaSession.sync);
  listen(audio, 'ended', () => playNextSong(1, { source: 'ended', ended: true }));
  listen(audio, 'error', () => {
    if (studioState.currentId) showToast('Audio unavailable. Reconnect your studio and try again.');
  });

  return {
    startSong,
    playSong,
    togglePlayback,
    playNextSong,
    playPreviousSong,
    syncMediaSession: mediaSession.sync,
    dispose: () => subscriptions.splice(0).forEach((unsubscribe) => unsubscribe()),
  };
}
