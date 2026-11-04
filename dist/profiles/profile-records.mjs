import { RequestError } from '../server/request-security.mjs';

export const defaultProfileId = 'guest';
export const ownerProfileId = (item) => item.profileId || defaultProfileId;

export function requireProfile(store, id = defaultProfileId) {
  const profile = store.state.profiles.find((item) => item.id === id);
  if (!profile) throw new RequestError(404, 'Profile not found.');
  return profile;
}

export function normalizeProfileName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 70)
    throw new RequestError(400, 'Give your profile a name of up to 70 characters.');
  return value.trim();
}
