// Request IDs are deduplication keys, not authentication credentials. getRandomValues
// also works over private HTTP connections, where randomUUID may be absent.
export function createRequestId(provider = globalThis.crypto) {
  if (typeof provider?.randomUUID === 'function') return provider.randomUUID();
  if (typeof provider?.getRandomValues === 'function') {
    const randomBytes = provider.getRandomValues(new Uint8Array(16));
    randomBytes[6] = (randomBytes[6] & 15) | 64;
    randomBytes[8] = (randomBytes[8] & 63) | 128;
    const hexadecimalId = Array.from(randomBytes, (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    return `${hexadecimalId.slice(0, 8)}-${hexadecimalId.slice(8, 12)}-${hexadecimalId.slice(12, 16)}-${hexadecimalId.slice(16, 20)}-${hexadecimalId.slice(20)}`;
  }
  return `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
