import { studioState } from '../app/browser-state.js';
import { setProfilePreference } from '../profiles/profile-preferences.js';
import { dominantCoverHue } from './cover-palette.js';
import { mediaUrl } from '../app/interface-helpers.js';
import { updateBrowserTheme } from './theme-favicon.js';

import { themes } from './theme-palettes.js';
export { themes } from './theme-palettes.js';

export const defaultTheme = themes.find((theme) => theme.id === 'silver-silence');

export function closestTheme(hue) {
  if (hue === null) return themes.find((theme) => theme.id === 'silver-silence');
  if (!Number.isFinite(hue)) return defaultTheme;
  const normalized = ((hue % 360) + 360) % 360;
  return themes
    .filter((theme) => theme.id !== 'magic' && theme.saturation !== 0)
    .reduce((closest, theme) => {
      const distance = (value) =>
        Math.min(Math.abs(normalized - value), 360 - Math.abs(normalized - value));
      return distance(theme.hue) < distance(closest.hue) ? theme : closest;
    });
}

async function readCoverHue(url, signal) {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  });
  if (!response.ok) throw new Error('Cover unavailable');
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    signal.throwIfAborted();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 48;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 48, 48);
    return dominantCoverHue(context.getImageData(0, 0, 48, 48).data);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function createThemeManager({
  root,
  storage,
  loadCoverHue = readCoverHue,
  coverUrl = (song) => mediaUrl(song.cover),
  onChange = () => {},
  onApply = () => {},
}) {
  let selected = 'magic';
  try {
    const saved = storage.getItem('encore-theme');
    if (themes.some((theme) => theme.id === saved)) selected = saved;
  } catch {
    /* Keep the default if browser storage is unavailable. */
  }
  let song = null,
    key = null,
    revision = 0,
    controller;
  let info = { status: 'idle', title: '' };
  const cache = new Map();
  const apply = (palette) => {
    root.dataset.theme = selected;
    root.style.setProperty('--theme-hue', palette.hue);
    root.style.setProperty('--theme-saturation', palette.saturation ?? 1);
    root.style.setProperty('--accent', palette.accent);
    root.style.setProperty('--button-primary-bg', palette.fill);
    root.style.setProperty('--button-primary-hover', palette.hover);
    onApply(palette);
    onChange();
  };
  async function sync(currentSong) {
    song = currentSong;
    const url = selected === 'magic' && song?.cover ? coverUrl(song) : null;
    const nextKey = selected + ':' + (url || 'none');
    if (key === nextKey) {
      if (selected === 'magic' && info.title && info.title !== (song?.title || 'your song')) {
        info = { ...info, title: song?.title || 'your song' };
        onChange();
      }
      return;
    }
    key = nextKey;
    const request = ++revision;
    controller?.abort();
    if (selected !== 'magic') {
      info = { status: 'idle', title: '' };
      apply(themes.find((theme) => theme.id === selected));
      return;
    }
    if (!url) {
      info = { status: 'waiting', title: '' };
      apply(defaultTheme);
      return;
    }
    info = { status: 'loading', title: song.title || 'your song' };
    onChange();
    controller = new AbortController();
    try {
      const match = cache.get(url) ?? closestTheme(await loadCoverHue(url, controller.signal));
      if (request !== revision) return;
      cache.set(url, match);
      if (cache.size > 32) cache.delete(cache.keys().next().value);
      info = {
        status: 'ready',
        title: song.title || 'your song',
        theme: match.name,
      };
      apply(match);
    } catch {
      if (request !== revision) return;
      info = { status: 'unavailable', title: song.title || 'your song' };
      apply(defaultTheme);
    }
  }
  return {
    get selection() {
      return selected;
    },
    get info() {
      return info;
    },
    sync,
    select(id, persist = true) {
      if (!themes.some((theme) => theme.id === id)) return;
      if (selected === id) return sync(song);
      selected = id;
      key = null;
      try {
        if (persist) storage.setItem('encore-theme', id);
      } catch {
        /* Still apply the theme for this session. */
      }
      return sync(song);
    },
  };
}

let manager;
const listeners = new Set();
function themeManager() {
  manager ||= createThemeManager({
    root: document.documentElement,
    storage: {
      getItem: () => studioState.profilePreferences?.theme || 'magic',
      setItem: (_, value) => {
        void setProfilePreference('theme', value);
      },
    },
    onApply: updateBrowserTheme,
    onChange: () => listeners.forEach((listener) => listener()),
  });
  return manager;
}
export const getSelectedThemeId = () => themeManager().selection;
export const getThemeInfo = () => themeManager().info;
export const selectTheme = (id) => themeManager().select(id);
export const syncSongTheme = (song) => {
  const manager = themeManager();
  const theme = studioState.profilePreferences?.theme || 'magic';
  if (manager.selection !== theme) void manager.select(theme, false);
  return manager.sync(song);
};
export const subscribeToTheme = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
