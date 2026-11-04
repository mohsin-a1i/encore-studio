import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ComfySongRenderer } from '../generation/song-audio-renderer.mjs';
import { SongService } from '../songs/song-service.mjs';
import { openLibraryStore } from '../library/library-store.mjs';
import { getSongFilePath } from '../songs/song-record.mjs';
import { objectInfo, workflowFile, referenceAbc } from './helpers/comfy-fixtures.mjs';

function wave() {
  const samples = 48000;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(48000, 24);
  buffer.writeUInt32LE(96000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    buffer.writeInt16LE(Math.round(5000 * Math.sin((2 * Math.PI * 440 * i) / samples)), 44 + i * 2);
  return buffer;
}

test('audio submission, download, encoding, replacement, and cleanup stay inside one song entity', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'encore-audio-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const comfyOutputRoot = path.join(root, 'comfy', 'audio');
  await mkdir(comfyOutputRoot, { recursive: true });
  const workflow = workflowFile();
  const coverWorkflow = workflowFile('yue2-song-from-reference-abc');
  const comfyInputRoot = path.join(root, 'comfy-input');
  await mkdir(comfyInputRoot);
  const promptId = '1f7f3748-fbfa-4bb9-b4c8-eb8362d9f022';
  let jobId;
  const bytes = wave();
  let downloadBytes = bytes;
  let submissions = 0;
  let graph;
  const server = http.createServer(async (request, response) => {
    try {
      if (request.url.startsWith('/view?')) {
        response.writeHead(200);
        return response.end(downloadBytes);
      }
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/queue')
        return response.end(JSON.stringify({ queue_running: [], queue_pending: [] }));
      if (request.url === '/object_info') return response.end(JSON.stringify(objectInfo));
      if (request.url === '/upload/image')
        throw new Error('Song rendering must not upload reference audio');
      if (request.url === '/prompt') {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const payload = JSON.parse(Buffer.concat(chunks));
        graph = payload.prompt;
        jobId = payload.client_id;
        assert.equal(graph['8'].inputs.filename_prefix, 'audio/Encore_' + jobId);
        assert.equal(graph['3'].inputs.mode, graph['2'] ? 'full' : 'melody');
        assert.equal(graph['3'].inputs.max_duration, 360);
        const lyrics = graph['3'].inputs.lyrics;
        assert.equal(lyrics, '[Verse]\nLakarr lakarr, o lakarhara!');
        assert.ok(!Object.values(graph).some((node) => node.class_type === 'LoadAudio'));
        if (!graph['2']) assert.match(graph['3'].inputs.abc, /^X:/);
        submissions++;
        await writeFile(path.join(comfyOutputRoot, 'Encore_' + jobId + '_00001.wav'), bytes);
        return response.end(
          JSON.stringify({ prompt_id: promptId, number: submissions, node_errors: {} }),
        );
      }
      if (request.url.startsWith('/history/'))
        return response.end(
          JSON.stringify({
            [promptId]: {
              prompt: [0, promptId, graph],
              status: { status_str: 'success', completed: true },
              outputs: {
                10: {
                  audio: [{ filename: 'Encore_' + jobId + '_00001.wav', subfolder: 'audio' }],
                },
              },
            },
          }),
        );
      response.writeHead(404);
      response.end('{}');
    } catch (error) {
      response.writeHead(500);
      response.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const renderer = new ComfySongRenderer({
    root,
    workflow,
    coverWorkflow,
    comfyInputRoot,
    samples: {
      ensure: async (song) => {
        song.sampleFile = `EncoreSample_${song.id}_test.mp3`;
        song.sampleSourceUrl = song.sampleUrl;
        const file = getSongFilePath(root, song, song.sampleFile);
        await writeFile(file, bytes);
        return file;
      },
    },
    comfyOutputRoot,
    comfy: `http://127.0.0.1:${server.address().port}`,
  });
  renderer.prepareReferenceNotation = async (song) => {
    song.referenceABC = referenceAbc;
    song.referenceABCSource = song.sampleFile;
    return song.referenceABC;
  };
  const store = await openLibraryStore(root);
  const songs = new SongService({
    store,
    renderer,
    writeLyrics: async () => ({
      title: 'Faran',
      style: 'Comedy rap',
      lyrics: '[Verse]\nLakarr lakarr, o lakarhara!',
      genres: ['Rap'],
    }),
    writeMetadata: async () => ({ title: 'Faran', genres: ['Rap'] }),
  });
  const idle = async () => {
    while (songs.generationPromise) await songs.generationPromise;
  };
  t.after(idle);
  const song = await songs.create('An absurdly lucky fool');
  await idle();
  await songs.generate(song.id, 'audio');
  await idle();
  assert.equal(song.status, 'ready', song.error);
  assert.ok(song.duration >= 1 && song.duration < 2);
  assert.equal(song.job.promptId, promptId);
  const originalAudio = song.audioFile;
  await access(getSongFilePath(root, song, originalAudio));
  await access(getSongFilePath(root, song, song.masterFile));
  assert.equal(submissions, 1);
  const response = JSON.parse(
    await readFile(getSongFilePath(root, song, 'work/' + song.job.id + '/submission.json'), 'utf8'),
  );
  assert.equal(response.prompt_id, promptId);
  await assert.rejects(access(path.join(comfyOutputRoot, `Encore_${jobId}_00001.wav`)), {
    code: 'ENOENT',
  });
  downloadBytes = Buffer.from('Invalid audio output');
  await songs.generate(song.id, 'audio', { style: 'A new sound' });
  await idle();
  assert.equal(song.status, 'ready');
  assert.equal(song.job.outcome, 'failed');
  assert.equal(song.audioFile, originalAudio);
  await access(getSongFilePath(root, song, originalAudio));
  await access(getSongFilePath(root, song, song.masterFile));
  await assert.rejects(access(getSongFilePath(root, song, `master-${song.job.id}.wav`)), {
    code: 'ENOENT',
  });
  const persisted = JSON.parse(await readFile(getSongFilePath(root, song, 'song.json'), 'utf8'));
  assert.equal(persisted.audioFile, originalAudio);
  downloadBytes = bytes;
  await songs.generate(song.id, 'audio', { style: 'Upbeat comedy pop' });
  await idle();
  assert.equal(song.status, 'ready', song.error);
  assert.notEqual(song.audioFile, originalAudio);
  await assert.rejects(access(getSongFilePath(root, song, originalAudio)), { code: 'ENOENT' });
  assert.equal(store.state.songs.length, 1);
  songs.storage.comfyInputRoot = comfyInputRoot;
  await songs.update(song.id, { sampleUrl: 'https://youtu.be/jNQXAC9IVRw' });
  await songs.prepareReference(song.id);
  await songs.referenceOperations.get(song.id)?.promise;
  await songs.generate(song.id, 'lyrics');
  await idle();
  await songs.generate(song.id, 'audio');
  await idle();
  assert.equal(song.status, 'ready', song.error);
  assert.equal(song.job.workflowName, 'yue2-song-from-reference-abc');
  const reference = song.sampleFile;
  await access(getSongFilePath(root, song, reference));
  await assert.rejects(access(path.join(comfyInputRoot, reference)), { code: 'ENOENT' });
  song.sampleKind = 'upload';
  song.sampleUrl = '';
  song.sampleSourceUrl = '';
  await songs.generate(song.id, 'audio');
  await idle();
  assert.equal(song.status, 'ready', song.error);
  assert.equal(song.job.workflowName, 'yue2-song-from-reference-abc');
  song.sampleKind = 'link';
  song.sampleUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  await songs.generate(song.id, 'lyrics', { sampleUrl: '', removeSample: true });
  await idle();
  await songs.generate(song.id, 'audio');
  await idle();
  assert.equal(song.status, 'ready', song.error);
  assert.equal(song.job.workflowName, 'yue2-song-from-style-and-lyrics');
  assert.equal(song.sampleFile, undefined);
  await assert.rejects(access(getSongFilePath(root, song, reference)), { code: 'ENOENT' });
  const previousSubmissions = submissions;
  renderer.samples.ensure = async () => {
    throw new Error('YouTube blocked the sample');
  };
  await songs.update(song.id, { sampleUrl: 'https://youtu.be/jNQXAC9IVRw' });
  await songs.prepareReference(song.id);
  await songs.referenceOperations.get(song.id)?.promise;
  assert.equal(song.status, 'ready');
  assert.equal(song.referencePreparation.outcome, 'failed');
  assert.match(song.referencePreparation.error, /YouTube blocked/);
  assert.equal(submissions, previousSubmissions);
});
