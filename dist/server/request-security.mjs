const browserFolders = new Set([
  'app',
  'studio',
  'songs',
  'generation',
  'library',
  'playback',
  'settings',
  'profiles',
  'explore',
  'assets',
]);
const browserExtensions = new Set([
  'js',
  'css',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'ico',
  'woff',
  'woff2',
]);

export function isPublicAssetPath(relativePath) {
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (normalizedPath === 'index.html' || normalizedPath === 'favicon.svg') return true;
  const segments = normalizedPath.split('/');
  return (
    browserFolders.has(segments[0]) &&
    !segments.some((segment) => segment.startsWith('.')) &&
    browserExtensions.has(segments.at(-1).split('.').at(-1).toLowerCase())
  );
}

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const readOptionalText = (value, maximumLength = 200) =>
  typeof value === 'string' ? value.trim().slice(0, maximumLength) : '';
export function requireSafeId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value))
    throw new RequestError(400, 'Invalid item.');
  return value;
}
export function normalizePlaylistInput(input) {
  const name = readOptionalText(input.name, 70);
  if (!name) throw new RequestError(400, 'Give your playlist a name.');
  return { name, description: readOptionalText(input.description, 240) };
}
