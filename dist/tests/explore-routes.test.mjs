import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { exploreRoutes } from '../explore/explore-routes.mjs';
import { sendJsonResponse } from '../server/http-responses.mjs';
import { stateFixture } from './helpers/state-fixture.mjs';
test('Explore commands are validated, profile-scoped and cannot use the retired generation API', async (t) => {
  const f = await stateFixture(t);
  const server = http.createServer(async (request, response) => {
    try {
      await exploreRoutes({
        request,
        response,
        routeSegments: request.url.split('/').filter(Boolean),
        explore: f.explore,
        profileId: request.headers['x-profile-id'] || 'guest',
      });
    } catch (e) {
      sendJsonResponse(response, e.status || 500, { error: e.message });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const call = async (route, input, profile = 'guest') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Profile-Id': profile,
      },
      body: JSON.stringify(input),
    });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await call('explore', { idea: 'old', sessionId: 'old' })).status, 404);
  assert.equal(
    (await call('explore/start', { idea: '', revision: 0, commandId: 'empty' })).status,
    400,
  );
  const start = await call('explore/start', {
    idea: 'Night drive',
    revision: 0,
    commandId: 'start',
  });
  assert.equal(start.status, 200);
  await f.settle();
  const view = f.explore.snapshot('guest');
  assert.equal(
    (
      await call(
        'explore/decision',
        { sessionId: view.sessionId, songId: view.songId, decision: 'keep' },
        'other',
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call('explore/decision', {
        sessionId: view.sessionId,
        songId: view.songId,
        decision: 'keep',
      })
    ).status,
    200,
  );
});
