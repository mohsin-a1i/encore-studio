import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

test('the service accepts direct API and media requests through any hostname without session tokens', async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'encore-access-'));
  const portProbe = net.createServer();
  await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../server/studio-server.mjs', import.meta.url))],
    {
      env: { ...process.env, PORT: String(port), ENCORE_DATA_DIR: dataRoot },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exit = once(child, 'exit');
      child.kill();
      await exit;
    }
    await rm(dataRoot, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) break;
    try {
      ready = (await fetch(base + '/api/health/studio')).ok;
      if (ready) break;
    } catch {}
    await delay(50);
  }
  assert.ok(ready, output);
  const headers = {
    Host: 'my-custom-encore.example:1234',
    Origin: 'https://another-client.example',
  };
  const library = await fetch(base + '/api/library', { headers });
  assert.equal(library.status, 200);
  assert.equal(library.headers.get('Access-Control-Allow-Origin'), '*');
  assert.deepEqual((await library.json()).songs, []);
  const status = await fetch(base + '/api/health/studio', { headers }).then((response) =>
    response.json(),
  );
  assert.equal(status.connected, true);
  assert.equal('token' in status, false);
  assert.equal((await fetch(base + '/api/session')).status, 404);
  const preflight = await fetch(base + '/api/playlists', {
    method: 'OPTIONS',
    headers: {
      ...headers,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type, X-Request-Id',
    },
  });
  assert.equal(preflight.status, 204);
  const created = await fetch(base + '/api/playlists', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Direct access' }),
  });
  assert.equal(created.status, 201);
  const playlist = await created.json();
  assert.equal((await fetch(base + '/' + playlist.cover, { headers })).status, 200);
  assert.equal((await fetch(base + '/server/configuration.mjs', { headers })).status, 403);
});
