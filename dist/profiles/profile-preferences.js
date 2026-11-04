import { studioState } from '../app/browser-state.js';
import { showToast } from '../app/interface-helpers.js';
let transport;
const pending = new Map();
const desired = new Map();
export function configureProfilePreferences(requestStudio) {
  transport = requestStudio;
}
export function applyProfilePreferences(preferences = { theme: 'magic', editorSections: {} }) {
  studioState.profilePreferences = preferences;
  studioState.editorSections = new Map(Object.entries(preferences.editorSections || {}));
}
export function setProfilePreference(key, value) {
  const profileId = studioState.profileId;
  const identity = `${profileId}:${key}`;
  const base = structuredClone(
    desired.has(identity)
      ? desired.get(identity)
      : (studioState.profilePreferences?.[key] ?? (key === 'theme' ? 'magic' : {})),
  );
  desired.set(identity, value);
  const work = (pending.get(profileId) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const result = await transport(`profiles/${profileId}/preferences`, {
        method: 'PATCH',
        headers: { 'X-Profile-Id': profileId },
        body: JSON.stringify({
          changes: { [key]: value },
          base: { [key]: base },
        }),
      });
      if (
        studioState.profileId === profileId &&
        result.revision >= (studioState.preferenceRevision || 0)
      ) {
        studioState.preferenceRevision = result.revision;
        applyProfilePreferences(result.preferences);
      }
      return result;
    })
    .finally(() => {
      if (desired.get(identity) === value) desired.delete(identity);
    });
  pending.set(profileId, work);
  work.catch((error) => {
    if (studioState.profileId === profileId) showToast(error.message);
  });
  return work;
}
