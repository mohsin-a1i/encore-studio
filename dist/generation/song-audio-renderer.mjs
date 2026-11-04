import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prepareSongWorkflow } from './workflow-builder.mjs';
import { comfyPromptIdPattern, workflowOwnsOutput } from './workflow-tracking.mjs';
import { getSongFilePath } from '../songs/song-record.mjs';
import { removeComfyOutputs } from '../songs/song-file-cleanup.mjs';
import { ReferenceAudioStore } from './reference-audio-store.mjs';
import { transcribeReference } from './reference-notation.mjs';

const exec = promisify(execFile);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function locateAudio(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.filename === 'string' && /\.(flac|mp3|wav|opus)$/i.test(value.filename))
    return value;
  for (const child of Object.values(value)) {
    const found = locateAudio(child);
    if (found) return found;
  }
  return null;
}

export class ComfySongRenderer {
  constructor({
    root,
    workflow,
    coverWorkflow,
    referenceWorkflow = new URL(
      './workflows/sheetsage2-reference-audio-to-abc.json',
      import.meta.url,
    ),
    ytDlp,
    comfy = 'http://127.0.0.1:8188',
    comfyOutputRoot,
    comfyInputRoot,
    samples = new ReferenceAudioStore({ ytDlp }),
  }) {
    Object.assign(this, {
      root,
      workflow,
      coverWorkflow,
      referenceWorkflow,
      comfy,
      comfyOutputRoot,
      comfyInputRoot,
      samples,
    });
  }

  async requestComfy(route, { signal, timeoutMs = 12000, ...options } = {}) {
    const response = await fetch(this.comfy + route, {
      ...options,
      headers:
        options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]),
    });
    const result = await response
      .text()
      .then((text) => (text.trim() ? JSON.parse(text) : {}))
      .catch(() => {
        throw new Error(`ComfyUI returned an unreadable response (HTTP ${response.status}).`);
      });
    if (!response.ok || result.error) {
      const details = [
        typeof result.error === 'string' ? result.error : result.error?.message,
        result.error?.details,
        ...Object.values(result.node_errors || {}).flatMap((node) =>
          (node.errors || []).map((error) =>
            [error.message, error.details].filter(Boolean).join(': '),
          ),
        ),
      ]
        .filter(Boolean)
        .join(' ');
      const error = new Error(
        'ComfyUI: ' + (details || 'request failed (HTTP ' + response.status + ').'),
      );
      error.response = result;
      throw error;
    }
    return result;
  }

  async uploadReferenceAudio(file, signal) {
    const form = new FormData();
    form.set(
      'image',
      new Blob([await readFile(file)], { type: 'audio/mpeg' }),
      path.basename(file),
    );
    form.set('type', 'input');
    form.set('overwrite', 'true');
    const uploaded = await this.requestComfy('/upload/image', {
      method: 'POST',
      body: form,
      signal,
      timeoutMs: 120000,
    });
    if (uploaded.name !== path.basename(file) || uploaded.subfolder || uploaded.type !== 'input')
      throw new Error('ComfyUI did not confirm the uploaded sample filename.');
    return uploaded.name;
  }

  async prepareReferenceNotation(song, job, context) {
    return transcribeReference(this, song, job, context);
  }

  async submitWorkflow(input, job, { folder, signal, referenceABC, save }) {
    const [template, objectInfo] = await Promise.all([
      readFile(referenceABC ? this.coverWorkflow : this.workflow, 'utf8').then(JSON.parse),
      this.requestComfy('/object_info', { signal }),
    ]);
    const graph = prepareSongWorkflow(template, objectInfo, input, {
      prefix: 'audio/Encore_' + job.id,
      referenceABC,
    });
    await writeFile(path.join(folder, 'workflow.json'), JSON.stringify(graph, null, 2));
    signal.throwIfAborted();
    let result;
    try {
      // Never abort or retry an in-flight submission: it may already be queued.
      // Save the returned ID even if cancellation arrived while awaiting it.
      result = await this.requestComfy('/prompt', {
        method: 'POST',
        body: JSON.stringify({ prompt: graph, client_id: job.id }),
      });
    } catch (error) {
      await writeFile(
        path.join(folder, 'submission.json'),
        JSON.stringify(error.response || { error: error.message }, null, 2),
      );
      if (!error.response)
        throw new Error(
          `ComfyUI submission could not be confirmed: ${error.message}. No replacement render was submitted.`,
          { cause: error },
        );
      throw error;
    }
    if (comfyPromptIdPattern.test(result.prompt_id)) {
      job.promptId = result.prompt_id;
      await save();
    }
    await writeFile(path.join(folder, 'submission.json'), JSON.stringify(result, null, 2));
    if (!job.promptId)
      throw new Error(
        'ComfyUI did not return a valid job ID. No replacement render was submitted.',
      );
    signal.throwIfAborted();
    return job.promptId;
  }

  async stop(job) {
    if (!job?.promptId) return;
    const queue = await this.requestComfy('/queue');
    if (queue.queue_running?.some((entry) => entry[1] === job.promptId)) {
      await this.requestComfy('/interrupt', {
        method: 'POST',
        body: JSON.stringify({ prompt_id: job.promptId }),
      });
      // Wait for ComfyUI to release this job before allowing another operation.
      for (let pollAttempt = 0; pollAttempt < 20; pollAttempt++) {
        const next = await this.requestComfy('/queue');
        if (!next.queue_running?.some((entry) => entry[1] === job.promptId)) return;
        await sleep(500);
      }
      throw new Error('ComfyUI is still stopping this song. Try again shortly.');
    }
    if (queue.queue_pending?.some((entry) => entry[1] === job.promptId))
      await this.requestComfy('/queue', {
        method: 'POST',
        body: JSON.stringify({ delete: [job.promptId] }),
      });
  }

  async confirmWorkflowSubmission(id, prefix) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const history = await this.requestComfy('/history/' + id);
      if (workflowOwnsOutput(history[id]?.prompt?.[2], prefix)) return;
      const queue = await this.requestComfy('/queue');
      if (
        [...(queue.queue_running || []), ...(queue.queue_pending || [])].some(
          (entry) => entry[1] === id && workflowOwnsOutput(entry[2], prefix),
        )
      )
        return;
      await sleep(250);
    }
    throw new Error(
      'ComfyUI did not confirm this song submission. No replacement render was submitted.',
    );
  }

  async executeGeneration(song, job, { folder, signal, update, save, onStart }) {
    const referenceABC = song.referenceABC || '';
    const withSample = Boolean(
      job.input.sampleUrl || song.sampleKind === 'upload' || song.referenceABC,
    );
    job.workflowName = withSample
      ? 'yue2-song-from-reference-abc'
      : 'yue2-song-from-style-and-lyrics';
    if (withSample) {
      if (!referenceABC || song.referenceABCSource !== song.sampleFile)
        throw new Error('Load the reference audio before generating a song.');
    }
    await update('preparing');
    const promptId = await this.submitWorkflow(job.input, job, {
      folder,
      signal,
      referenceABC,
      save,
    });
    await this.confirmWorkflowSubmission(promptId, `audio/Encore_${job.id}`);
    await update('rendering');
    let output;
    for (let pollAttempt = 0; pollAttempt < 450; pollAttempt++) {
      signal.throwIfAborted();
      const history = await this.requestComfy('/history/' + promptId);
      const result = history[promptId];
      if (result?.status?.status_str === 'error') {
        const detail = result.status.messages?.find((item) => item[0] === 'execution_error')?.[1];
        throw new Error(detail?.exception_message || 'ComfyUI could not render the song.');
      }
      if (result?.status?.completed) {
        output = locateAudio(result.outputs);
        if (!output) throw new Error('The workflow finished without an audio output.');
        break;
      }
      await sleep(4000);
    }
    if (!output)
      throw new Error('The render exceeded 30 minutes. Check ComfyUI before trying again.');
    signal.throwIfAborted();
    await update('saving');
    const filename = path.basename(output.filename);
    if (filename !== output.filename || String(output.subfolder || '').includes('..'))
      throw new Error('ComfyUI returned an invalid output path.');
    job.output = output;
    const url = new URL('/view', this.comfy);
    url.search = new URLSearchParams({
      filename,
      subfolder: output.subfolder || '',
      type: 'output',
    });
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
    });
    if (!response.ok) throw new Error('The audio could not be downloaded from ComfyUI.');
    const masterFile = `master-${job.id}${path.extname(filename)}`;
    const audioFile = `audio-${job.id}.mp3`;
    const master = getSongFilePath(this.root, song, masterFile);
    const mp3 = getSongFilePath(this.root, song, audioFile);
    await writeFile(master, Buffer.from(await response.arrayBuffer()));
    signal.throwIfAborted();
    await exec(
      process.env.FFMPEG_BIN || 'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        master,
        '-map_metadata',
        '-1',
        '-codec:a',
        'libmp3lame',
        '-q:a',
        '2',
        '-metadata',
        `title=${song.title}`,
        mp3,
      ],
      { windowsHide: true, timeout: 180000, signal },
    );
    const probe = await exec(
      process.env.FFPROBE_BIN || 'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', mp3],
      { windowsHide: true, signal },
    );
    const duration = Number(JSON.parse(probe.stdout).format.duration);
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error('The generated audio could not be read.');
    signal.throwIfAborted();
    const audioFields = ['audioFile', 'masterFile', 'duration', 'audioVersion'];
    const previousAudio = Object.fromEntries(audioFields.map((key) => [key, song[key]]));
    Object.assign(song, { audioFile, masterFile, duration, audioVersion: job.id });
    job.finishedAt = new Date().toISOString();
    try {
      await update('ready');
    } catch (error) {
      for (const key of audioFields) {
        if (previousAudio[key] === undefined) delete song[key];
        else song[key] = previousAudio[key];
      }
      throw error;
    }
    await removeComfyOutputs(this.comfyOutputRoot, [job.id]).catch(() => {});
  }
}
