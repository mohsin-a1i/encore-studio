import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { transcribeReference } from '../generation/reference-notation.mjs';
import { objectInfo, referenceAbc, workflowFile } from './helpers/comfy-fixtures.mjs';

test('reference transcription reports its queue and running states before saving the score', async (t) => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'encore-notation-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const promptId = 'e8186c6f-8aef-43ba-aca3-79f72d7895d7';
  let polls = 0;
  const renderer = {
    referenceWorkflow: workflowFile('sheetsage2-reference-audio-to-abc'),
    uploadReferenceAudio: async () => 'EncoreSample_test.mp3',
    confirmWorkflowSubmission: async () => {},
    requestComfy: async (route) => {
      if (route === '/object_info') return objectInfo;
      if (route === '/prompt') return { prompt_id: promptId };
      if (route.startsWith('/history/'))
        return polls >= 2
          ? {
              [promptId]: { status: { completed: true }, outputs: { 4: { text: [referenceAbc] } } },
            }
          : {};
      if (route === '/queue') {
        polls++;
        return polls === 1
          ? { queue_pending: [[1, promptId]], queue_running: [] }
          : { queue_pending: [], queue_running: [[1, promptId]] };
      }
      throw new Error(`Unexpected request: ${route}`);
    },
  };
  const phases = [];
  const song = { sampleFile: 'sample.mp3' };
  const job = { id: 'test-job' };
  const abc = await transcribeReference(renderer, song, job, {
    sampleFile: 'sample.mp3',
    folder,
    signal: new AbortController().signal,
    save: async () => {},
    update: async (phase) => {
      job.phase = phase;
      phases.push(phase);
    },
  });
  assert.deepEqual(phases, ['preparing', 'queued', 'transcribing']);
  assert.equal(abc, referenceAbc.trim());
  assert.equal(song.referenceABCSource, song.sampleFile);
});
