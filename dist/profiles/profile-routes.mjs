import { workspace, updatePreferences, publicProfile } from './profile-workspace.mjs';
import { randomUUID } from 'node:crypto';
import { RequestError } from '../server/request-security.mjs';
import { readJsonBody, sendJsonResponse } from '../server/http-responses.mjs';
import { removePlaylistFolder } from '../songs/song-file-cleanup.mjs';
import { requireProfile, normalizeProfileName, ownerProfileId } from './profile-records.mjs';
import { getIdleSongStatus } from '../songs/song-status.js';

export function profileRoutes(context) {
  return context.request.method === 'GET'
    ? handleProfiles(context)
    : context.songs.runExclusive(() => handleProfiles(context));
}

async function handleProfiles({ request, response, routeSegments, store, songs, dataRoot }) {
  const id = routeSegments[2];
  if (routeSegments.length === 2 && request.method === 'GET')
    return sendJsonResponse(response, 200, {
      profiles: store.state.profiles.map(publicProfile),
    });
  if (routeSegments.length === 2 && request.method === 'POST') {
    const input = await readJsonBody(request);
    const profile = {
      id: randomUUID(),
      name: normalizeProfileName(input.name),
      createdAt: new Date().toISOString(),
    };
    store.state.profiles.push(profile);
    await store.save();
    return sendJsonResponse(response, 201, profile);
  }
  if (
    routeSegments.length === 4 &&
    routeSegments[3] === 'preferences' &&
    request.method === 'PATCH'
  ) {
    const profile = requireProfile(store, id);
    const before = structuredClone(workspace(profile));
    try {
      const result = updatePreferences(profile, await readJsonBody(request));
      await store.save();
      return sendJsonResponse(response, 200, result);
    } catch (error) {
      profile.workspace = before;
      throw error;
    }
  }
  if (routeSegments.length !== 3) throw new RequestError(404, 'Endpoint not found.');
  const profile = requireProfile(store, id);
  if (request.method === 'PATCH') {
    const input = await readJsonBody(request);
    if (input.baseName !== undefined && input.baseName !== profile.name)
      throw new RequestError(
        409,
        'This profile was renamed on another device. Reopen it before saving.',
      );
    profile.name = normalizeProfileName(input.name);
    await store.save();
    return sendJsonResponse(response, 200, profile);
  }
  if (request.method === 'DELETE') {
    const input = await readJsonBody(request);
    if (input.confirmation !== id)
      throw new RequestError(400, 'Confirm this profile before deleting it.');
    // Use the same serialized operation as song creation and playlist edits.
    // Stop queued work first so deleting one song cannot start the next one.
    const ownedSongs = store.state.songs.filter((song) => ownerProfileId(song) === id);
    for (const song of ownedSongs) {
      if (song.job?.phase !== 'queued') continue;
      song.status = getIdleSongStatus(song);
      song.job.outcome = 'cancelled';
      song.job.finishedAt = new Date().toISOString();
      delete song.job.phase;
    }
    for (const song of ownedSongs) await songs.deleteSong(song.id, song.id);
    await songs.cleanupPendingFiles();
    if (store.state.pendingSongDeletions.some((item) => item.profileId === id))
      throw new RequestError(
        409,
        'Some files are still in use. Try deleting this profile again shortly.',
      );
    for (const playlist of store.state.playlists.filter((item) => ownerProfileId(item) === id)) {
      await removePlaylistFolder(dataRoot, playlist.id);
      store.state.playlists = store.state.playlists.filter((item) => item !== playlist);
      await store.save();
    }
    store.state.profiles = store.state.profiles.filter((item) => item.id !== id);
    const deletedIds = store.state.deletedSongIds.filter(
      (songId) => store.state.deletedSongProfiles[songId] === id,
    );
    store.state.deletedSongIds = store.state.deletedSongIds.filter(
      (songId) => !deletedIds.includes(songId),
    );
    for (const songId of deletedIds) delete store.state.deletedSongProfiles[songId];
    if (!store.state.profiles.length)
      store.state.profiles.push({
        id: randomUUID(),
        name: 'Guest',
        createdAt: new Date().toISOString(),
      });
    await store.save();
    return sendJsonResponse(response, 200, {
      deleted: true,
      profiles: store.state.profiles,
    });
  }
  throw new RequestError(405, 'Method not allowed.');
}
