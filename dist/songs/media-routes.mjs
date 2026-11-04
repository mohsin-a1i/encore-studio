import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RequestError, requireSafeId } from '../server/request-security.mjs';
import { readJsonBody, sendJsonResponse, streamMediaFile } from '../server/http-responses.mjs';
import { getSongFilePath, getSongDirectory, isSongGenerating } from './song-record.mjs';
import { getMediaArtworkFile } from '../playback/media-artwork.mjs';
import { mediaArtworkSizes } from '../playback/media-artwork.js';
import { defaultProfileId, ownerProfileId, requireProfile } from '../profiles/profile-records.mjs';

export function mediaRoutes(context) {
  return context.request.method === 'POST'
    ? context.songs.runExclusive(() => handleMedia(context))
    : handleMedia(context);
}

async function handleMedia({
  request,
  response,
  routeSegments,
  store,
  dataRoot,
  profileId = defaultProfileId,
}) {
  requireProfile(store, profileId);
  if (routeSegments[1] === 'cover' && request.method === 'POST') {
    const kind = routeSegments[2],
      id = requireSafeId(routeSegments[3]),
      item = (
        kind === 'song' ? store.state.songs : kind === 'playlist' ? store.state.playlists : []
      ).find((i) => i.id === id && ownerProfileId(i) === profileId);
    if (!item) throw new RequestError(404, 'Item not found.');
    if (kind === 'song' && isSongGenerating(item))
      throw new RequestError(409, 'Wait for generation to finish before changing the cover.');
    const input = await readJsonBody(request);
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(input.image || '');
    if (!match) throw new RequestError(400, 'Choose a PNG, JPG, or WebP image.');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 3_000_000) throw new RequestError(413, 'Choose an image smaller than 3 MB.');
    const valid =
      match[1] === 'png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : match[1] === 'jpeg'
          ? bytes[0] === 255 && bytes[1] === 216
          : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) throw new RequestError(400, 'The image file is invalid.');
    const folder =
      kind === 'song' ? getSongDirectory(dataRoot, id) : path.join(dataRoot, 'playlists', id);
    await mkdir(folder, { recursive: true });
    const filename = 'cover-' + Date.now() + '.' + (match[1] === 'jpeg' ? 'jpg' : match[1]);
    const file = path.join(folder, filename);
    await writeFile(file, bytes);
    item.coverFile = kind === 'song' ? filename : file;
    item.coverVersion = filename;
    await store.save();
    return sendJsonResponse(response, 200, { ok: true });
  }
  if (routeSegments[1] === 'cover' && ['GET', 'HEAD'].includes(request.method)) {
    const item = (
      routeSegments[2] === 'song'
        ? store.state.songs
        : routeSegments[2] === 'playlist'
          ? store.state.playlists
          : []
    ).find((i) => i.id === requireSafeId(routeSegments[3]) && ownerProfileId(i) === profileId);
    if (!item?.coverFile) throw new RequestError(404, 'Cover not found.');
    if (routeSegments.length > 4) {
      const pixels = /^(\d+)\.png$/.exec(routeSegments[5] || '');
      const size = Number(pixels?.[1]);
      if (
        routeSegments.length !== 6 ||
        routeSegments[2] !== 'song' ||
        routeSegments[4] !== 'media' ||
        !mediaArtworkSizes.includes(size)
      )
        throw new RequestError(404, 'Media artwork not found.');
      const file = await getMediaArtworkFile(
        getSongFilePath(dataRoot, item, item.coverFile),
        getSongDirectory(dataRoot, item.id),
        size,
      );
      return streamMediaFile(request, response, file);
    }
    return await streamMediaFile(
      request,
      response,
      routeSegments[2] === 'song'
        ? getSongFilePath(dataRoot, item, item.coverFile)
        : item.coverFile,
    );
  }
  if (
    ['audio', 'download', 'sample'].includes(routeSegments[1]) &&
    ['GET', 'HEAD'].includes(request.method)
  ) {
    const song = store.state.songs.find(
      (s) => s.id === requireSafeId(routeSegments[2]) && ownerProfileId(s) === profileId,
    );
    if (!song) throw new RequestError(404, 'Song not found.');
    const file =
      routeSegments[1] === 'sample'
        ? song.sampleSourceUrl === song.sampleUrl
          ? song.sampleFile
          : null
        : routeSegments[1] === 'download'
          ? song.masterFile || song.audioFile
          : song.audioFile;
    if (!file) throw new RequestError(404, 'Audio not found.');
    return await streamMediaFile(
      request,
      response,
      getSongFilePath(dataRoot, song, file),
      routeSegments[1] === 'download' ? song.title + path.extname(file) : null,
    );
  }

  throw new RequestError(404, 'Endpoint not found.');
}
