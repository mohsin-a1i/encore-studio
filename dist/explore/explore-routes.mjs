import { readJsonBody, sendJsonResponse } from '../server/http-responses.mjs';
import { RequestError } from '../server/request-security.mjs';

export async function exploreRoutes({ request, response, routeSegments, explore, profileId }) {
  if (request.method !== 'POST' || routeSegments.length !== 3)
    throw new RequestError(404, 'Endpoint not found.');
  const commands = { start: 'start', decision: 'decide', retry: 'retry' };
  const method = commands[routeSegments[2]];
  if (!method) throw new RequestError(404, 'Endpoint not found.');
  const input = await readJsonBody(request);
  sendJsonResponse(response, 200, await explore[method](profileId, input));
}
