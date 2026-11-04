import test from 'node:test';
import assert from 'node:assert/strict';
import { createDependencyStatus } from '../server/dependency-status.mjs';

function fixture() {
  const calls = { codex: 0, comfy: 0, files: 0 };
  const available = { codex: false, comfy: false };
  let time = 1000;
  const health = createDependencyStatus(
    {
      codex: 'codex',
      comfy: 'http://comfy',
      queue: { activeSongId: null },
      workflow: 'music.json',
      coverWorkflow: 'cover.json',
      ytDlp: 'yt-dlp',
    },
    {
      now: () => time,
      request: async () => {
        calls.comfy++;
        return { ok: available.comfy };
      },
      execute: async (_command, args) => {
        calls.codex++;
        assert.deepEqual(args, ['login', 'status']);
        if (!available.codex) throw new Error('Not signed in');
      },
      exists: async () => {
        calls.files++;
      },
    },
  );
  return {
    health,
    calls,
    available,
    advance: () => {
      time += 20001;
    },
  };
}

test('individual retries bypass cached failures and check only the selected dependency', async () => {
  const { health, calls, available } = fixture();
  assert.equal(health.snapshot().connected, true);
  assert.deepEqual(calls, { codex: 0, comfy: 0, files: 0 });
  assert.equal((await health()).codex, false);
  assert.deepEqual(calls, { codex: 1, comfy: 1, files: 3 });
  available.codex = true;
  available.comfy = true;
  assert.equal((await health()).codex, false, 'Normal polling uses the cache');
  const codex = await health('codex');
  assert.equal(codex.codex, true);
  assert.equal(codex.comfy, false, 'Codex retry must not recheck ComfyUI');
  assert.deepEqual(calls, { codex: 2, comfy: 1, files: 3 });
  assert.equal((await health('comfy')).comfy, true);
  assert.deepEqual(calls, { codex: 2, comfy: 2, files: 3 });
  await assert.rejects(health('unknown'), /Unknown connection/);
});

test('background checks expire independently after 20 seconds', async () => {
  const { health, calls, advance } = fixture();
  await health();
  advance();
  await health('codex');
  await health();
  assert.deepEqual(calls, { codex: 2, comfy: 2, files: 6 });
});
