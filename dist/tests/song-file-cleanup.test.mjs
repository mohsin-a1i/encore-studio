import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { removeComfyInputs, removeComfyOutputs } from '../songs/song-file-cleanup.mjs';

test('renamed media cleanup still recognizes owned files from before the rename', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'encore-files-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inputs = path.join(root, 'inputs');
  const outputs = path.join(root, 'outputs');
  await mkdir(inputs);
  await mkdir(outputs);
  const samples = ['AfterglowSample_song_old.mp3', 'EncoreSample_song_new.mp3'];
  const renders = ['Afterglow_owned_0001.flac', 'Encore_owned_0002.wav'];
  for (const name of samples) await writeFile(path.join(inputs, name), 'sample');
  for (const name of [...renders, 'Afterglow_other_0001.flac'])
    await writeFile(path.join(outputs, name), 'audio');
  await removeComfyInputs(inputs, samples);
  await removeComfyOutputs(outputs, ['owned']);
  for (const name of samples)
    await assert.rejects(access(path.join(inputs, name)), { code: 'ENOENT' });
  for (const name of renders)
    await assert.rejects(access(path.join(outputs, name)), { code: 'ENOENT' });
  await access(path.join(outputs, 'Afterglow_other_0001.flac'));
});
