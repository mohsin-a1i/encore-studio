import { librarySnapshot } from './library-snapshot.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCoverArtwork } from './cover-artwork.mjs';
import { serializePlaylist } from './api-responses.mjs';
import {
  RequestError,
  requireSafeId,
  normalizePlaylistInput,
} from '../server/request-security.mjs';
import { readJsonBody, sendJsonResponse } from '../server/http-responses.mjs';
import { removePlaylistFolder } from '../songs/song-file-cleanup.mjs';
import { defaultProfileId, ownerProfileId, requireProfile } from '../profiles/profile-records.mjs';

export function libraryRoutes(context) {
  return context.request.method === 'GET'
    ? handleLibrary(context)
    : context.songs.runExclusive(() => handleLibrary(context));
}

async function handleLibrary({
  request,
  response,
  routeSegments,
  store,
  dataRoot,
  profileId = defaultProfileId,
}) {
  requireProfile(store, profileId);
  const ownedSongs = store.state.songs.filter((item) => ownerProfileId(item) === profileId);
  const ownedPlaylists = store.state.playlists.filter((item) => ownerProfileId(item) === profileId);
  if (routeSegments[1] === 'library' && request.method === 'GET')
    return sendJsonResponse(response, 200, librarySnapshot(store.state, profileId));
  if (
    routeSegments[1] === 'playlists' &&
    routeSegments.length === 5 &&
    routeSegments[3] === 'songs' &&
    request.method === 'DELETE'
  ) {
    const playlistId = requireSafeId(routeSegments[2]),
      songId = requireSafeId(routeSegments[4]);
    const playlist = ownedPlaylists.find((item) => item.id === playlistId);
    if (!playlist) throw new RequestError(404, 'Playlist not found.');
    playlist.songIds = playlist.songIds.filter((id) => id !== songId);
    playlist.editRevision = (playlist.editRevision || 0) + 1;
    await store.save();
    return sendJsonResponse(response, 200, {
      removed: true,
      playlistId,
      songId,
    });
  }
  if (routeSegments[1] === 'playlists' && request.method === 'POST') {
    const input = normalizePlaylistInput(await readJsonBody(request)),
      id = randomUUID(),
      folder = path.join(dataRoot, 'playlists', id);
    await mkdir(folder, { recursive: true });
    const coverFile = path.join(folder, 'cover.svg');
    await writeFile(
      coverFile,
      createCoverArtwork({
        id,
        title: input.name,
        subtitle: 'ENCORE PLAYLIST',
        seed: id,
      }),
    );
    const playlist = {
      id,
      profileId,
      ...input,
      songIds: [],
      coverFile,
      createdAt: new Date().toISOString(),
    };
    store.state.playlists.push(playlist);
    await store.save();
    return sendJsonResponse(response, 201, serializePlaylist(playlist));
  }
  if (routeSegments[1] === 'playlists' && routeSegments[2]) {
    const playlist = ownedPlaylists.find(
      (playlist) => playlist.id === requireSafeId(routeSegments[2]),
    );
    if (!playlist) throw new RequestError(404, 'Playlist not found.');
    if (request.method === 'PATCH') {
      const input = await readJsonBody(request);
      if (input.baseRevision !== undefined && input.baseRevision !== (playlist.editRevision || 0))
        throw new RequestError(
          409,
          'This playlist changed on another device. Reopen it before saving.',
        );
      if (input.name !== undefined) Object.assign(playlist, normalizePlaylistInput(input));
      if (input.songIds !== undefined || input.addSongIds !== undefined) {
        const selected = input.addSongIds ?? input.songIds;
        if (
          !Array.isArray(selected) ||
          selected.length > 1000 ||
          selected.some(
            (id) => !ownedSongs.some((song) => song.id === id && song.audioFile && !song.temporary),
          )
        )
          throw new RequestError(400, 'Unknown song in playlist.');
        playlist.songIds = [
          ...new Set(input.addSongIds ? [...playlist.songIds, ...selected] : selected),
        ];
      }
      playlist.editRevision = (playlist.editRevision || 0) + 1;
      await store.save();
      return sendJsonResponse(response, 200, serializePlaylist(playlist));
    }
    if (request.method === 'DELETE') {
      store.state.playlists = store.state.playlists.filter(
        (candidatePlaylist) => candidatePlaylist !== playlist,
      );
      await store.save();
      await removePlaylistFolder(dataRoot, playlist.id);
      return sendJsonResponse(response, 200, { ok: true });
    }
  }
  throw new RequestError(404, 'Endpoint not found.');
}
