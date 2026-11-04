import { readDevice, writeDevice } from '../app/device-state.js';
import { createRequestId } from '../app/request-id.js';
export function createDevicePlayback({ state, audio, requestStudio, findSong }) {
  const clientId = createRequestId();
  let restored = null,
    lastSave = 0,
    leaseKey = null;
  function save() {
    if (state.currentId)
      writeDevice(
        'playback',
        {
          id: state.currentId,
          position: audio.currentTime || 0,
          queue: state.queue,
        },
        state.profileId,
      );
  }
  function lease() {
    if (!state.connected) return;
    const key = state.profileId + ':' + (state.currentId || '');
    leaseKey = key;
    void requestStudio('playback', {
      method: 'POST',
      body: JSON.stringify({ clientId, songId: state.currentId || null }),
    }).catch(() => {});
  }
  function restore() {
    if (restored === state.profileId || !state.connected) return;
    restored = state.profileId;
    audio.volume = state.volume;
    const saved = readDevice('playback', null, state.profileId);
    if (saved && state.deletedSongIds?.includes(saved.id))
      writeDevice('playback', null, state.profileId);
    if (saved && findSong(saved.id)?.audio && !state.currentId) {
      state.currentId = saved.id;
      state.queue = (saved.queue || [saved.id]).filter((id) => findSong(id)?.audio);
      const id = saved.id,
        profileId = state.profileId;
      audio.addEventListener(
        'loadedmetadata',
        () => {
          if (
            state.profileId === profileId &&
            state.currentId === id &&
            Number.isFinite(audio.duration)
          )
            audio.currentTime = Math.min(Math.max(0, saved.position || 0), audio.duration);
        },
        { once: true },
      );
    }
  }
  function sync() {
    if (leaseKey !== state.profileId + ':' + (state.currentId || '')) {
      save();
      lease();
    }
  }
  function clear() {
    writeDevice('playback', null, state.profileId);
    lease();
  }
  audio.addEventListener('timeupdate', () => {
    if (Date.now() - lastSave > 2000) {
      lastSave = Date.now();
      save();
    }
  });
  audio.addEventListener('pause', save);
  globalThis.addEventListener?.('pagehide', save);
  const timer = setInterval(lease, 20000);
  timer.unref?.();
  return { restore, sync, clear, save };
}
