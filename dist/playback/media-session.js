// Bridge the browser player to headset buttons, media keys and lock-screen controls.
import { getMediaArtwork } from './media-artwork.js';
import { getSongGenres } from '../songs/song-genres.js';

export function createMediaSessionControls({
  audio,
  getSong,
  play,
  pause,
  next,
  previous,
  coverUrl,
  session = globalThis.navigator?.mediaSession,
  Metadata = globalThis.MediaMetadata,
}) {
  if (!session) return { sync() {}, updatePosition() {}, bind() {} };
  let metadataKey;

  function updatePosition() {
    if (!session.setPositionState) return;
    try {
      if (!getSong() || !Number.isFinite(audio.duration) || audio.duration <= 0) {
        session.setPositionState();
        return;
      }
      session.setPositionState({
        duration: audio.duration,
        position: Math.min(audio.duration, Math.max(0, audio.currentTime || 0)),
        playbackRate: audio.playbackRate || 1,
      });
    } catch {
      // Some browsers expose only part of the Media Session API.
    }
  }

  function sync() {
    const song = getSong();
    audio.title = song?.title || 'Encore Studio';
    let artwork = [];
    try {
      artwork = getMediaArtwork(song?.cover, coverUrl);
    } catch {
      // Artwork is optional.
    }
    try {
      const nextKey = song
        ? JSON.stringify([song.id, song.title, getSongGenres(song), artwork])
        : null;
      if (nextKey !== metadataKey) {
        session.metadata =
          song && Metadata
            ? new Metadata({
                title: song.title || 'Untitled song',
                artist: 'Encore Studio',
                album: getSongGenres(song).join(', ') || 'Encore Originals',
                artwork,
              })
            : null;
        metadataKey = nextKey;
      }
    } catch {
      // Native controls must not prevent playback in browsers with limited support.
    }
    try {
      session.playbackState = !song ? 'none' : audio.paused || audio.ended ? 'paused' : 'playing';
    } catch {
      // Playback-state support is independent of metadata support.
    }
    updatePosition();
  }

  function seek(position, fast = false) {
    if (!getSong() || !Number.isFinite(position) || !Number.isFinite(audio.duration)) return;
    const bounded = Math.max(0, Math.min(audio.duration, position));
    if (fast && audio.fastSeek) audio.fastSeek(bounded);
    else audio.currentTime = bounded;
    updatePosition();
  }

  function invoke(action) {
    try {
      const result = action();
      result?.catch?.(() => sync());
    } catch {
      sync();
    }
  }
  const handlers = {
    play: () => invoke(play),
    pause: () => invoke(pause),
    nexttrack: () => invoke(next),
    previoustrack: () => invoke(previous),
    seekto: (details = {}) => invoke(() => seek(details.seekTime, details.fastSeek)),
    seekbackward: (details = {}) =>
      invoke(() => seek(audio.currentTime - (details.seekOffset || 10))),
    seekforward: (details = {}) =>
      invoke(() => seek(audio.currentTime + (details.seekOffset || 10))),
    stop: () => {
      invoke(() => {
        pause();
        seek(0);
      });
    },
  };
  function bind() {
    metadataKey = undefined;
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Register the remaining actions even when one is unsupported.
      }
    }
    sync();
  }
  bind();
  return { sync, updatePosition, bind };
}
