import { RequestError } from '../server/request-security.mjs';
import { themes } from '../settings/theme-palettes.js';

export const defaultPreferences = () => ({
  theme: 'magic',
  editorSections: {},
});
export const emptyExplore = () => ({
  revision: 0,
  sessionId: null,
  idea: '',
  queueIds: [],
  reservations: [],
  decisions: {},
  retiredIds: [],
  error: '',
});
export function workspace(profile) {
  profile.workspace ||= {
    preferences: defaultPreferences(),
    preferenceRevision: 0,
    explore: emptyExplore(),
  };
  return profile.workspace;
}
export function publicProfile({ workspace: _workspace, ...profile }) {
  return profile;
}
export function updatePreferences(profile, input) {
  const state = workspace(profile);
  const changes = input.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes))
    throw new RequestError(400, 'Invalid preferences.');
  const allowed = new Set(['theme', 'editorSections']);
  for (const [key, value] of Object.entries(changes)) {
    if (!allowed.has(key)) throw new RequestError(400, 'Unknown preference.');
    if (
      key !== 'editorSections' &&
      JSON.stringify(state.preferences[key]) !== JSON.stringify(input.base?.[key]) &&
      JSON.stringify(state.preferences[key]) !== JSON.stringify(value)
    )
      throw new RequestError(409, 'Settings changed on another device. Refresh and try again.');
    if (key === 'theme' && !themes.some((theme) => theme.id === value))
      throw new RequestError(400, 'Unknown theme.');
    if (key === 'editorSections') {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).length > 2000
      )
        throw new RequestError(400, 'Invalid editor preferences.');
      for (const [id, sections] of Object.entries(value)) {
        if (
          !/^[a-zA-Z0-9_-]{1,100}$/.test(id) ||
          !sections ||
          typeof sections !== 'object' ||
          Array.isArray(sections)
        )
          throw new RequestError(400, 'Invalid editor preferences.');
        for (const [section, open] of Object.entries(sections))
          if (!['reference', 'style', 'lyrics'].includes(section) || typeof open !== 'boolean')
            throw new RequestError(400, 'Invalid editor preferences.');
      }
    }
  }
  const accepted = structuredClone(changes);
  if (changes.editorSections) {
    const sections = structuredClone(state.preferences.editorSections);
    const base = input.base?.editorSections || {};
    for (const [id, values] of Object.entries(changes.editorSections)) {
      for (const [key, value] of Object.entries(values)) {
        if (value === base[id]?.[key]) continue;
        if (sections[id]?.[key] !== base[id]?.[key] && sections[id]?.[key] !== value)
          throw new RequestError(409, 'Editor settings changed on another device.');
        sections[id] = { ...sections[id], [key]: value };
      }
    }
    accepted.editorSections = sections;
  }
  state.preferences = { ...state.preferences, ...accepted };
  state.preferenceRevision++;
  return { preferences: state.preferences, revision: state.preferenceRevision };
}
