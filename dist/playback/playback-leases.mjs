import { readJsonBody, sendJsonResponse } from '../server/http-responses.mjs';
import { RequestError, requireSafeId } from '../server/request-security.mjs';
import { ownerProfileId } from '../profiles/profile-records.mjs';

/** Runtime leases protect a temporary track while another device finishes listening. */
export class PlaybackLeases {
  constructor(now = Date.now) {
    this.now = now;
    this.clients = new Map();
  }
  touch(profileId, clientId, songId) {
    requireSafeId(clientId);
    if (songId)
      this.clients.set(`${profileId}:${clientId}`, {
        songId,
        expires: this.now() + 65000,
      });
    else this.clients.delete(`${profileId}:${clientId}`);
  }
  isPlaying(songId) {
    for (const [key, lease] of this.clients)
      if (lease.expires <= this.now()) this.clients.delete(key);
    return [...this.clients.values()].some((lease) => lease.songId === songId);
  }
}
export async function playbackRoutes({ request, response, songs, profileId }) {
  if (request.method !== 'POST') throw new RequestError(405, 'Method not allowed.');
  const input = await readJsonBody(request);
  if (input.songId && ownerProfileId(songs.get(input.songId)) !== profileId)
    throw new RequestError(404, 'Song not found.');
  songs.mediaUse.touch(profileId, input.clientId, input.songId || null);
  sendJsonResponse(response, 200, { ok: true });
}
