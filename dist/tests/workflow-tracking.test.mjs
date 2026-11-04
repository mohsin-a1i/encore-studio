import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ComfySongRenderer } from '../generation/song-audio-renderer.mjs';
import { objectInfo, workflowFile } from './helpers/comfy-fixtures.mjs';

const id = '1f7f3748-fbfa-4bb9-b4c8-eb8362d9f022';

async function submission(t, respond, { cancelled = false } = {}) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'encore-submit-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const controller = new AbortController();
  if (cancelled) controller.abort();
  const requests = [];
  const server = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/object_info') return response.end(JSON.stringify(objectInfo));
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ route: request.url, body: JSON.parse(Buffer.concat(chunks)) });
    respond(request, response, controller);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const renderer = new ComfySongRenderer({
    root: folder,
    workflow: workflowFile(),
    comfy: `http://127.0.0.1:${server.address().port}`,
  });
  const job = { id: 'test-job' };
  let savedId;
  const executeGeneration = () =>
    renderer.submitWorkflow({ style: 'English pop', lyrics: '[Chorus]\nKeep on going' }, job, {
      folder,
      signal: controller.signal,
      save: async () => {
        savedId = job.promptId;
      },
    });
  return { executeGeneration, requests, job, folder, saved: () => savedId };
}

test('ComfyUI validation errors are surfaced with node details and never retried', async (t) => {
  const f = await submission(t, (_req, response) => {
    response.writeHead(400);
    response.end(
      JSON.stringify({
        error: { message: 'Prompt validation failed' },
        node_errors: {
          25: { errors: [{ message: 'Required input is missing', details: 'lyrics' }] },
        },
      }),
    );
  });
  await assert.rejects(
    f.executeGeneration(),
    /Prompt validation failed.*Required input is missing: lyrics/,
  );
  assert.equal(f.requests.length, 1);
  assert.equal(f.job.promptId, undefined);
  const record = JSON.parse(await readFile(path.join(f.folder, 'submission.json'), 'utf8'));
  assert.equal(record.error.message, 'Prompt validation failed');
});

test('an ambiguous submission failure never queues a replacement', async (t) => {
  const f = await submission(t, (request) => request.socket.destroy());
  await assert.rejects(f.executeGeneration(), /submission could not be confirmed/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.job.promptId, undefined);
});

test('a malformed submission ID cannot become a tracked render', async (t) => {
  const f = await submission(t, (_req, response) =>
    response.end(JSON.stringify({ prompt_id: 'invented' })),
  );
  await assert.rejects(f.executeGeneration(), /valid job ID/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.job.promptId, undefined);
});

test('cancellation before submission does not queue audio', async (t) => {
  const f = await submission(t, () => assert.fail('Must not submit'), { cancelled: true });
  await assert.rejects(f.executeGeneration(), { name: 'AbortError' });
  assert.equal(f.requests.length, 0);
});

test('cancellation during submission preserves the returned ID so the job can be stopped', async (t) => {
  const f = await submission(t, (_req, response, controller) => {
    controller.abort();
    response.end(JSON.stringify({ prompt_id: id, number: 0, node_errors: {} }));
  });
  await assert.rejects(f.executeGeneration(), { name: 'AbortError' });
  assert.equal(f.requests.length, 1);
  assert.equal(f.job.promptId, id);
  assert.equal(f.saved(), id);
  assert.equal(f.requests[0].body.client_id, f.job.id);
});

test('ComfyUI confirms the render belongs to this song before polling its output', async () => {
  const renderer = new ComfySongRenderer({ root: '.', workflow: 'workflow.json' });
  const prefix = 'audio/Encore_this-song';
  renderer.requestComfy = async (route) =>
    route === '/queue'
      ? { queue_running: [[0, id, { 10: { inputs: { filename_prefix: prefix } } }]] }
      : {};
  await renderer.confirmWorkflowSubmission(id, prefix);
  renderer.requestComfy = async () => ({});
  await assert.rejects(renderer.confirmWorkflowSubmission(id, prefix), /did not confirm/);
});

test('stopping a song deletes only its queued render or interrupts its running render', async () => {
  const renderer = new ComfySongRenderer({ root: '.', workflow: 'workflow.json' });
  const calls = [];
  renderer.requestComfy = async (route, options) => {
    calls.push({ route, options });
    return {
      queue_pending: [
        [0, id],
        [1, 'other-song'],
      ],
    };
  };
  await renderer.stop({ promptId: id });
  assert.deepEqual(JSON.parse(calls[1].options.body), { delete: [id] });
  calls.length = 0;
  renderer.requestComfy = async (route, options) => {
    calls.push({ route, options });
    return calls.length === 1 ? { queue_running: [[0, id]] } : {};
  };
  await renderer.stop({ promptId: id });
  assert.equal(calls[1].route, '/interrupt');
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), { prompt_id: id });
});

test("ComfyUI queue deletion and interruption accept the server's empty HTTP responses", async (t) => {
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* Drain the request. */
    }
    response.writeHead(200);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const renderer = new ComfySongRenderer({
    root: '.',
    comfy: `http://127.0.0.1:${server.address().port}`,
  });
  for (const route of ['/queue', '/interrupt'])
    assert.deepEqual(await renderer.requestComfy(route, { method: 'POST', body: '{}' }), {});
});
