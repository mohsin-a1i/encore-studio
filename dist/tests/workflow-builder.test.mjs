import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSongWorkflow, prepareReferenceWorkflow } from '../generation/workflow-builder.mjs';
import { objectInfo, savedWorkflow, referenceAbc } from './helpers/comfy-fixtures.mjs';
import { createReferenceMelody } from '../generation/reference-melody.mjs';
const input = { style: 'Playful hip-hop', lyrics: '[Chorus]\nA new day' };
const options = { prefix: 'audio/Encore_test', seed: 123 };

test('clean text workflow plans a score and keeps the latent length linked to the song', async () => {
  const template = await savedWorkflow('yue2-song-from-style-and-lyrics');
  const original = structuredClone(template);
  const graph = prepareSongWorkflow(template, objectInfo, input, options);
  assert.deepEqual(template, original);
  assert.equal(Object.keys(graph).length, 8);
  assert.equal(graph['2'].inputs.style, input.style);
  assert.equal(graph['3'].inputs.lyrics, input.lyrics);
  assert.deepEqual(graph['3'].inputs.abc, ['2', 0]);
  assert.deepEqual(graph['5'].inputs.seconds, ['3', 1]);
  assert.equal(graph['6'].inputs.steps, 32);
  assert.equal(graph['6'].inputs.sampler_name, 'dpm_2');
  assert.equal(graph['6'].inputs.seed, 123);
  assert.equal(graph['8'].inputs.filename_prefix, options.prefix);
});
test('clean cover workflow consumes saved ABC directly and has no audio input or encoder', async () => {
  const abc = referenceAbc;
  const graph = prepareSongWorkflow(
    await savedWorkflow('yue2-song-from-reference-abc'),
    objectInfo,
    input,
    {
      ...options,
      referenceABC: abc,
    },
  );
  assert.equal(Object.keys(graph).length, 7);
  assert.equal(graph['3'].inputs.abc, createReferenceMelody(abc));
  assert.equal(graph['3'].inputs.mode, 'melody');
  assert.ok(
    !Object.values(graph).some((n) =>
      ['LoadAudio', 'AudioEncoderLoader', 'SheetSage2AudioToABC', 'YuE2GenerateABC'].includes(
        n.class_type,
      ),
    ),
  );
});
test('only the ABC transcription workflow loads reference audio', async () => {
  const graph = prepareReferenceWorkflow(
    await savedWorkflow('sheetsage2-reference-audio-to-abc'),
    objectInfo,
    {
      sampleName: 'EncoreSample_test.mp3',
      prefix: 'audio/Encore_test_abc',
    },
  );
  assert.equal(Object.keys(graph).length, 4);
  assert.equal(graph['1'].inputs.audio, 'EncoreSample_test.mp3');
  assert.equal(graph['2'].inputs.audio_encoder_name, 'minimax-music3\\sheetsage2_bf16.safetensors');
  assert.equal(graph['3'].class_type, 'SheetSage2AudioToABC');
  assert.equal(graph['4'].inputs.filename_prefix, 'audio/Encore_test_abc');
});
test('missing nodes and credit-using workflows are rejected before submission', async () => {
  const template = await savedWorkflow('yue2-song-from-style-and-lyrics');
  assert.throws(() => prepareSongWorkflow(template, {}, input, options), /missing the/);
  const paid = structuredClone(objectInfo);
  paid.YuE2GenerateMusic.api_node = true;
  assert.throws(() => prepareSongWorkflow(template, paid, input, options), /credit-free/);
});
