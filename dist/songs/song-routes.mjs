import { randomUUID } from 'node:crypto';
import { readJsonBody, sendJsonResponse } from '../server/http-responses.mjs';
import { RequestError, readOptionalText, requireSafeId } from '../server/request-security.mjs';
import { serializeSong } from '../library/api-responses.mjs';
import { normalizeReferenceUrl } from '../generation/reference-audio-store.mjs';
import { defaultProfileId, ownerProfileId } from '../profiles/profile-records.mjs';

export async function songRoutes({
  request,
  response,
  routeSegments,
  songs,
  health,
  profileId = defaultProfileId,
}) {
  const requestId = readOptionalText(request.headers['x-request-id'], 100) || randomUUID();
  const id = routeSegments[2] && requireSafeId(routeSegments[2]);
  if (id && ownerProfileId(songs.get(id)) !== profileId)
    throw new RequestError(404, 'Song not found.');
  if (routeSegments.length === 3 && request.method === 'GET')
    return sendJsonResponse(response, 200, serializeSong(songs.get(id)));
  if (routeSegments.length === 3 && request.method === 'PATCH') {
    const edits = await readJsonBody(request, 35_000_000);
    if (
      ['title', 'style', 'lyrics', 'sampleUrl', 'sampleUpload', 'removeSample'].some(
        (key) => edits[key] !== undefined,
      ) &&
      !Number.isSafeInteger(edits.baseRevision)
    )
      throw new RequestError(409, 'Reload this song before saving edits.');
    return sendJsonResponse(response, 200, serializeSong(await songs.update(id, edits)));
  }
  if (routeSegments.length === 3 && request.method === 'DELETE') {
    const input = await readJsonBody(request);
    return sendJsonResponse(response, 200, await songs.delete(id, input.confirmation));
  }
  if (request.method !== 'POST') throw new RequestError(404, 'Endpoint not found.');
  const input = await readJsonBody(request, 35_000_000);
  if (routeSegments.length === 4 && routeSegments[3] === 'copy')
    return sendJsonResponse(response, 201, serializeSong(await songs.copy(id, requestId)));
  if (routeSegments.length === 4 && routeSegments[3] === 'cancel')
    return sendJsonResponse(response, 200, serializeSong(await songs.cancel(id)));
  if (routeSegments.length === 4 && routeSegments[3] === 'reference') {
    const current = await health();
    if (!current.comfy || (songs.get(id).sampleUrl && !current.ytDlp))
      throw new RequestError(
        503,
        'ComfyUI or the audio downloader is unavailable. Check the studio connection.',
      );
    return sendJsonResponse(
      response,
      202,
      serializeSong(await songs.prepareReference(id, requestId)),
    );
  }
  const create = routeSegments.length === 2;
  if (create && input.kind === 'draft')
    return sendJsonResponse(
      response,
      201,
      serializeSong(await songs.create('', requestId, input.sampleUrl ?? '', input, profileId)),
    );
  const kind =
    (create && input.kind !== 'audio') || routeSegments[3] === 'lyrics'
      ? 'lyrics'
      : (create && input.kind === 'audio') || routeSegments[3] === 'audio'
        ? 'audio'
        : null;
  if (!kind || (!create && routeSegments.length !== 4))
    throw new RequestError(404, 'Endpoint not found.');
  if (create)
    return sendJsonResponse(
      response,
      202,
      serializeSong(
        await songs.create(input.idea ?? '', requestId, input.sampleUrl ?? '', input, profileId),
      ),
    );
  if (!Number.isSafeInteger(input.baseRevision))
    throw new RequestError(409, 'Reload this song before generating.');
  const current = await health();
  if (kind === 'audio')
    input.sampleUrl = normalizeReferenceUrl(input.sampleUrl ?? songs.get(id).sampleUrl ?? '');
  const withSample = Boolean(
    input.sampleUpload ||
    input.sampleUrl ||
    (!input.removeSample && songs.get(id).sampleKind === 'upload'),
  );
  if (
    (kind === 'lyrics' && !current.codex) ||
    (kind === 'audio' &&
      (!current.comfy ||
        !(withSample ? current.coverWorkflow : current.workflow) ||
        (input.sampleUrl && !current.ytDlp)))
  )
    throw new RequestError(
      503,
      kind === 'lyrics'
        ? 'Codex is unavailable. Check the studio connection.'
        : withSample
          ? 'ComfyUI, the cover workflow, or yt-dlp is unavailable. Check the studio connection.'
          : 'ComfyUI or the song workflow is unavailable. Check the studio connection.',
    );
  const song = await songs.generate(id, kind, input, requestId);
  return sendJsonResponse(response, 202, serializeSong(song));
}
