import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeLyricsWithCodex } from '../generation/lyrics/codex-runner.mjs';
import {
  createSongCompletionSchema,
  saveResponseSchema,
} from '../generation/lyrics/song-completion-schema.mjs';

async function fixture(t, overrides = {}) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'encore-codex-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.killed = true;
  };
  let argumentsPassed;
  const promise = writeLyricsWithCodex({
    folder,
    schema: await saveResponseSchema(folder, createSongCompletionSchema({})),
    prompt: 'Write a draft.',
    timeoutMs: 1000,
    timeoutMessage: 'Task expired.',
    spawnProcess: (_command, args) => {
      argumentsPassed = args;
      return child;
    },
    ...overrides,
  });
  return { child, folder, promise, argumentsPassed };
}

test('Codex reads structured output and disables ComfyUI for song writing', async (t) => {
  const f = await fixture(t);
  const result = { title: 'A small hello', lyrics: 'Hello, hello' };
  await writeFile(path.join(f.folder, 'result.json'), JSON.stringify(result));
  f.child.stdout.write('progress\n{"type":"item.completed","item":');
  f.child.stdout.write('{"type":"mcp_tool_call","tool":"server_info"}}\n');
  f.child.emit('close', 0);
  assert.deepEqual(await f.promise, result);
  assert.ok(f.argumentsPassed.includes('mcp_servers.comfyui.enabled=false'));
  assert.ok(f.argumentsPassed.includes('--sandbox'));
});

test('Codex process failure cannot accept a stale result', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.folder, 'result.json'), '{"title":"stale"}');
  const rejected = assert.rejects(f.promise, /exit 1/);
  f.child.emit('close', 1);
  await rejected;
});

test('Codex timeout kills the process and ignores its late completion', async (t) => {
  const f = await fixture(t, { timeoutMs: 10 });
  await assert.rejects(f.promise, /Task expired/);
  assert.equal(f.child.killed, true);
  f.child.emit('close', 0);
});

test('a cancelled Codex task cannot continue to render', async (t) => {
  const f = await fixture(t, { isCancelled: () => true });
  const rejected = assert.rejects(f.promise, /Cancelled/);
  f.child.emit('close', 0);
  await rejected;
});

test('explicit model and reasoning settings are passed as per-run CLI overrides', async (t) => {
  const f = await fixture(t, {
    model: 'gpt-6.1-terra',
    reasoningEffort: 'medium',
  });
  assert.equal(f.argumentsPassed[f.argumentsPassed.indexOf('--model') + 1], 'gpt-6.1-terra');
  assert.ok(f.argumentsPassed.includes('model_reasoning_effort="medium"'));
  assert.ok(f.argumentsPassed.includes('mcp_servers.comfyui.enabled=false'));
  await writeFile(path.join(f.folder, 'result.json'), '{"ok":true}');
  f.child.emit('close', 0);
  assert.deepEqual(await f.promise, { ok: true });
});
