import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveCodexExecutable } from '../server/codex-executable.mjs';

test('background services find the desktop CLI without PATH and ignore incomplete installations', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'encore-codex-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const installRoot = path.join(folder, 'OpenAI', 'Codex', 'bin');
  const executable = path.join(installRoot, 'installed', 'codex.exe');
  await mkdir(path.dirname(executable), { recursive: true });
  await mkdir(path.join(installRoot, 'incomplete'));
  await writeFile(executable, '');

  assert.equal(resolveCodexExecutable({ LOCALAPPDATA: folder }, 'win32'), executable);
});

test('explicit CLI configuration takes priority over automatic discovery', () => {
  assert.equal(resolveCodexExecutable({ CODEX_BIN: 'custom-codex' }, 'win32'), 'custom-codex');
});

test('CLI discovery preserves PATH installations and handles quoted directories with spaces', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'encore codex '));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const executable = path.join(folder, 'codex.exe');
  await writeFile(executable, '');

  assert.equal(resolveCodexExecutable({ Path: `"${folder}"` }, 'win32'), executable);
});

test('missing Windows installations and other platforms retain normal command lookup', () => {
  assert.equal(resolveCodexExecutable({}, 'win32'), 'codex');
  assert.equal(resolveCodexExecutable({}, 'linux'), 'codex');
});
