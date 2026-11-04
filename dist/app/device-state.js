// Device preferences and unacknowledged text recovery are the only browser-owned durable state.
export function readDevice(key, fallback = null, profileId = null) {
  try {
    const value = globalThis.localStorage?.getItem(
      `encore-device:${profileId ? profileId + ':' : ''}${key}`,
    );
    return value === null || value === undefined ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}
export function writeDevice(key, value, profileId = null) {
  try {
    const name = `encore-device:${profileId ? profileId + ':' : ''}${key}`;
    if (value === undefined || value === null) globalThis.localStorage?.removeItem(name);
    else globalThis.localStorage?.setItem(name, JSON.stringify(value));
  } catch {
    /* A device with browser storage disabled can still use all server-owned data. */
  }
}
