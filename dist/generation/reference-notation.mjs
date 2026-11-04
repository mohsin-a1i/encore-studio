import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareReferenceWorkflow } from './workflow-builder.mjs';
import { comfyPromptIdPattern } from './workflow-tracking.mjs';
import { removeComfyInputs, removeComfyOutputs } from '../songs/song-file-cleanup.mjs';

export async function transcribeReference(
  renderer,
  song,
  job,
  { sampleFile, folder, signal, save, update },
) {
  if (song.referenceABC && song.referenceABCSource === song.sampleFile) return song.referenceABC;
  await update('preparing');
  const [template, info] = await Promise.all([
    readFile(renderer.referenceWorkflow, 'utf8').then(JSON.parse),
    renderer.requestComfy('/object_info', { signal }),
  ]);
  const sampleName = await renderer.uploadReferenceAudio(sampleFile, signal);
  const prefix = `audio/Encore_${job.id}_abc`;
  const graph = prepareReferenceWorkflow(template, info, { sampleName, prefix });
  await writeFile(path.join(folder, 'reference-workflow.json'), JSON.stringify(graph, null, 2));
  signal.throwIfAborted();
  let submission;
  try {
    // An uncertain submission is never retried or replaced automatically.
    submission = await renderer.requestComfy('/prompt', {
      method: 'POST',
      body: JSON.stringify({ prompt: graph, client_id: job.id }),
    });
  } catch (error) {
    await writeFile(
      path.join(folder, 'reference-submission.json'),
      JSON.stringify(error.response || { error: error.message }, null, 2),
    );
    throw error;
  }
  if (!comfyPromptIdPattern.test(submission.prompt_id))
    throw new Error('ComfyUI did not return a valid reference transcription ID.');
  job.promptId = submission.prompt_id;
  job.referencePromptId = submission.prompt_id;
  job.referenceWorkflowName = 'sheetsage2-reference-audio-to-abc';
  await save();
  await writeFile(
    path.join(folder, 'reference-submission.json'),
    JSON.stringify(submission, null, 2),
  );
  signal.throwIfAborted();
  await renderer.confirmWorkflowSubmission(job.promptId, prefix);
  const outputId = Object.keys(graph).find((id) => graph[id].class_type === 'SaveText');
  let activePolls = 0;
  let missingPolls = 0;
  let phase = job.phase;
  while (activePolls < 450) {
    signal.throwIfAborted();
    const history = await renderer.requestComfy('/history/' + job.referencePromptId, { signal });
    const result = history[job.referencePromptId];
    if (result?.status?.status_str === 'error') {
      const detail = result.status.messages?.find((item) => item[0] === 'execution_error')?.[1];
      throw new Error(
        detail?.exception_message || 'ComfyUI could not transcribe the reference audio.',
      );
    }
    if (result?.status?.completed) {
      const texts = [result.outputs?.[outputId]?.text]
        .flat(Infinity)
        .filter((value) => typeof value === 'string');
      const abc = texts.join('\n\n').trim();
      if (!/^X:/m.test(abc) || !/^K:/m.test(abc))
        throw new Error('SheetSage2 finished without usable ABC notation.');
      song.referenceABC = abc;
      song.referenceABCSource = song.sampleFile;
      delete job.promptId;
      await save();
      await removeComfyInputs(renderer.comfyInputRoot, [sampleName]);
      await removeComfyOutputs(renderer.comfyOutputRoot, [job.id]);
      return abc;
    }
    const queue = await renderer.requestComfy('/queue', { signal });
    const queued = queue.queue_pending?.some((entry) => entry[1] === job.referencePromptId);
    const running = queue.queue_running?.some((entry) => entry[1] === job.referencePromptId);
    if (queued || running) {
      missingPolls = 0;
      const nextPhase = queued ? 'queued' : 'transcribing';
      if (phase !== nextPhase) {
        await update(nextPhase);
        phase = nextPhase;
      }
      if (running) activePolls++;
    } else {
      // The job may move from the queue into history between the two requests.
      if (++missingPolls >= 3)
        throw new Error('ComfyUI no longer has the reference job. Load the reference again.');
    }
    await delay(2000, undefined, { signal });
  }
  throw new Error('Reference transcription took too long. Check ComfyUI before trying again.');
}
