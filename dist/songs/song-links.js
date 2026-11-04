export function createSongLink(id, profileId) {
  const url = new URL('https://encore.eu1.netbird.services/');
  if (profileId) url.searchParams.set('profile', profileId);
  url.hash = 'song/' + encodeURIComponent(id);
  return url.href;
}

export function getSharedSongId(hash = location.hash) {
  const match = /^#song\/([^/]+)$/.exec(hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
