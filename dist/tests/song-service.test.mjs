import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { ReferenceAudioStore } from '../generation/reference-audio-store.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openLibraryStore } from '../library/library-store.mjs';
import { SongService } from '../songs/song-service.mjs';
import { serializeSong } from '../library/api-responses.mjs';
import { getSongFilePath, getSongDirectory } from '../songs/song-record.mjs';
import { removeSongFolder } from '../songs/song-file-cleanup.mjs';
import { referenceAbc } from './helpers/comfy-fixtures.mjs';
import { songStatuses } from '../songs/song-status.js';

const text = {
  title: 'A little courage',
  style: 'Soft indie pop',
  lyrics: '[Chorus]\nHello, hello',
  genres: ['Pop'],
};

test('new lyrics contrast with preserved old lyrics and recent songs from the same profile', async (t) => {
  let prompt;
  const { manager, store, idle, root } = await fixture(t, {
    writeLyrics: async (request) => {
      prompt = request.prompt;
      return text;
    },
  });
  const song = await manager.create('First idea', 'contrast-first');
  await idle();
  await manager.update(song.id, { lyrics: '' });
  assert.equal((await openLibraryStore(root)).state.songs[0].previousLyrics, text.lyrics);
  store.state.songs.push(
    {
      ...structuredClone(song),
      id: 'recent-song',
      lyrics: 'A boat made from orange peels',
      previousLyrics: '',
    },
    {
      ...structuredClone(song),
      id: 'private-song',
      profileId: 'other-profile',
      lyrics: 'PRIVATE OTHER PROFILE LYRICS',
      previousLyrics: '',
    },
  );
  await manager.generate(song.id, 'lyrics', { idea: 'A completely new story' });
  await idle();
  assert.ok(prompt.includes(JSON.stringify(text.lyrics)));
  assert.match(prompt, /A boat made from orange peels/);
  assert.doesNotMatch(prompt, /PRIVATE OTHER PROFILE LYRICS/);
  assert.match(prompt, /as different as possible/);
  assert.match(prompt, /Do not recycle lines/);
  assert.equal(serializeSong(song).previousLyrics, undefined);
});

test('Explore completes an idea into temporary audio and saves the same entity', async (t) => {
  let prompt;
  const { manager, idle, root } = await fixture(t, {
    writeMetadata: async (request) => {
      prompt = request.prompt;
      return text;
    },
  });
  const song = await manager.create('A moonlit drive', 'explore-request', '', {
    kind: 'explore',
    exploreSession: 'session-one',
  });
  assert.equal(song.temporary, true);
  await idle();
  assert.equal(song.status, 'ready', song.error);
  assert.equal(song.idea, 'A moonlit drive');
  assert.match(prompt, /A moonlit drive/);
  assert.ok(song.audioFile);
  const audioFile = song.audioFile;
  const saved = await manager.saveExploration(song.id);
  assert.equal(saved.id, song.id);
  assert.equal(saved.temporary, undefined);
  assert.equal(saved.exploreSession, undefined);
  assert.equal(saved.audioFile, audioFile);
  const reopened = await openLibraryStore(root);
  assert.equal(reopened.state.songs.find((item) => item.id === song.id).temporary, undefined);
  await access(getSongFilePath(root, song, audioFile));
});

test('Explore cannot save unfinished audio', async (t) => {
  const { manager } = await fixture(t);
  const song = await manager.create('', 'unfinished', '', { kind: 'draft' });
  await assert.rejects(manager.saveExploration(song.id), /Wait for this song/);
});

test('a manually named song keeps its title through lyric generation and regeneration', async (t) => {
  const { manager, idle } = await fixture(t);
  const song = await manager.create('A first idea', 'named-new-song', '', { title: 'My title' });
  await idle();
  assert.equal(song.title, 'My title');
  assert.equal(song.lyrics, text.lyrics);
  await manager.update(song.id, { title: '  My title  ' });
  await manager.generate(song.id, 'lyrics', { idea: 'A different idea' });
  await idle();
  assert.equal(song.title, '  My title  ');
  await manager.update(song.id, { title: '' });
  await manager.generate(song.id, 'lyrics', { idea: 'One more idea' });
  await idle();
  assert.equal(song.title, text.title);
});

test('a new song sends its entered musical style into lyric generation', async (t) => {
  let prompt;
  const { manager, idle } = await fixture(t, {
    writeLyrics: async (request) => {
      prompt = request.prompt;
      return text;
    },
  });
  const song = await manager.create('A first idea', 'styled-new-song', '', {
    style: '  Slow piano with warm strings\nSoft percussion  ',
  });
  await idle();
  assert.equal(song.job.input.style, '  Slow piano with warm strings\nSoft percussion  ');
  assert.equal(song.style, '  Slow piano with warm strings\nSoft percussion  ');
  assert.equal(song.genreStyle, song.style);
  assert.match(prompt, /Slow piano with warm strings/);
});

test('auto complete preserves entered lyrics and skips Codex once every field is complete', async (t) => {
  const requests = [];
  const { manager, idle } = await fixture(t, {
    writeLyrics: async (request) => {
      const schema = JSON.parse(await readFile(request.schema, 'utf8'));
      requests.push({ schema, prompt: request.prompt });
      return {
        title: 'Unexpected title',
        style: 'Unexpected style',
        lyrics: 'Unexpected lyrics',
        genres: ['Indie Pop'],
      };
    },
  });
  const song = await manager.create('My idea', 'entered-material', '', {
    title: 'My title',
    style: 'My style',
    lyrics: '[Verse]\nMy exact words',
  });
  await idle();
  assert.deepEqual(requests[0].schema.required, ['genres']);
  assert.match(requests[0].prompt, /My exact words/);
  assert.equal(song.title, 'My title');
  assert.equal(song.style, 'My style');
  assert.equal(song.lyrics, '[Verse]\nMy exact words');
  await manager.generate(song.id, 'lyrics', { idea: 'An updated idea' });
  await idle();
  assert.equal(requests.length, 1);
  assert.equal(song.idea, 'An updated idea');
  await manager.generate(song.id, 'lyrics', { style: 'A different sound' });
  await idle();
  assert.deepEqual(requests[1].schema.required, ['genres']);
  assert.equal(song.style, 'A different sound');
  assert.equal(song.genreStyle, 'A different sound');
  assert.equal(song.lyrics, '[Verse]\nMy exact words');
});

test('song generation requires only lyrics and fills missing details before ComfyUI', async (t) => {
  let renderInput;
  let requested;
  const { manager, idle, renderer } = await fixture(t, {
    writeMetadata: async (request) => {
      requested = JSON.parse(await readFile(request.schema, 'utf8')).required;
      assert.match(request.prompt, /My only lyrics/);
      return { title: 'Morning', style: 'Warm acoustic pop', genres: ['Acoustic Pop'] };
    },
  });
  const render = renderer.executeGeneration;
  renderer.executeGeneration = async (song, job, context) => {
    renderInput = structuredClone(job.input);
    return render(song, job, context);
  };
  const song = await manager.create('', 'lyrics-only-song', '', {
    kind: 'audio',
    lyrics: '[Verse]\nMy only lyrics',
  });
  await idle();
  assert.equal(song.status, 'ready', song.error);
  assert.deepEqual(requested, ['title', 'style', 'genres']);
  assert.equal(renderInput.style, 'Warm acoustic pop');
  assert.equal(renderInput.lyrics, '[Verse]\nMy only lyrics');
  assert.equal(song.genreStyle, 'Warm acoustic pop');
});

test('regeneration accepts a lyrics-only response while keeping existing song details', async (t) => {
  let schema;
  const { manager, idle } = await fixture(t);
  const song = await manager.create('First idea');
  await idle();
  manager.writeLyrics = async (request) => {
    schema = JSON.parse(await readFile(request.schema, 'utf8'));
    return { lyrics: '[Verse]\nAnother morning' };
  };
  await manager.generate(song.id, 'lyrics', { idea: 'Another take', lyrics: '' });
  await idle();
  assert.equal(song.job.outcome, 'complete', song.error);
  assert.deepEqual(schema.required, ['lyrics']);
  assert.equal(song.title, text.title);
  assert.equal(song.style, text.style);
  assert.deepEqual(song.genres, text.genres);
  assert.equal(song.lyrics, '[Verse]\nAnother morning');
});

test('composing fills a missing title and refreshes genres only when needed', async (t) => {
  const calls = [];
  const { manager, idle } = await fixture(t, {
    writeMetadata: async (request) => {
      calls.push(request.prompt);
      return { title: 'A new title', genres: [calls.length === 1 ? 'Indie Rock' : 'Synth Pop'] };
    },
  });
  const song = await manager.create('', 'manual-metadata', '', {
    kind: 'draft',
    style: 'Indie rock',
    lyrics: 'These are the words',
  });
  await manager.generate(song.id, 'audio');
  await idle();
  assert.equal(song.title, 'A new title');
  assert.deepEqual(song.genres, ['Indie Rock']);
  assert.equal(song.genreStyle, 'Indie rock');
  await manager.generate(song.id, 'audio');
  await idle();
  assert.equal(calls.length, 1);
  await manager.generate(song.id, 'audio', { title: '' });
  await idle();
  assert.equal(calls.length, 2);
  assert.equal(song.title, 'A new title');
  assert.deepEqual(song.genres, ['Indie Rock']);
  await manager.generate(song.id, 'audio', { style: 'Synth pop' });
  await idle();
  assert.equal(calls.length, 3);
  assert.equal(song.title, 'A new title');
  assert.deepEqual(song.genres, ['Synth Pop']);
  assert.equal(song.genreStyle, 'Synth pop');
});

test('copies increment names within their profile, including copies of copies', async (t) => {
  const { manager, idle } = await fixture(t);
  const original = await manager.create('First idea');
  await idle();
  const second = await manager.copy(original.id);
  const third = await manager.copy(original.id);
  const fourth = await manager.copy(second.id);
  assert.equal(second.title, `${original.title} 2`);
  assert.equal(third.title, `${original.title} 3`);
  assert.equal(fourth.title, `${original.title} 4`);
});
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'encore-songs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await openLibraryStore(root);
  const renderer = {
    stop: async () => {},
    prepareReferenceNotation: async (song) => {
      song.referenceABC = referenceAbc;
      song.referenceABCSource = song.sampleFile;
      return song.referenceABC;
    },
    executeGeneration: async (song, job, { update }) => {
      await update('rendering');
      song.audioFile = `audio-${job.id}.mp3`;
      song.masterFile = `master-${job.id}.flac`;
      song.audioVersion = job.id;
      song.duration = 123;
      await writeFile(getSongFilePath(root, song, song.audioFile), 'Independent audio');
      await writeFile(getSongFilePath(root, song, song.masterFile), 'Independent master');
      await update('ready');
    },
    ...options.renderer,
  };
  const manager = new SongService({
    store,
    renderer,
    writeLyrics: async () => text,
    writeMetadata: async () => ({
      title: 'Generated title',
      style: 'Acoustic pop',
      genres: ['Pop'],
    }),
    ...options,
  });
  const idle = async () => {
    while (manager.generationPromise) await manager.generationPromise;
  };
  t.after(idle);
  return { root, store, manager, idle, renderer };
}

test('samples belong to each song copy and are cleaned up with their ComfyUI input copies', async (t) => {
  let writingRequest;
  const { root, store, manager, idle } = await fixture(t, {
    samples: {
      ensure: async (song, _job, context) => {
        song.sampleFile = `EncoreSample_${song.id}_reference.mp3`;
        song.sampleSourceUrl = song.sampleUrl;
        const file = getSongFilePath(context.root, song, song.sampleFile);
        await writeFile(file, 'Reference audio');
        return file;
      },
    },
    writeLyrics: async (request) => {
      writingRequest = request;
      return text;
    },
  });
  const inputRoot = path.join(root, 'comfy-input');
  await mkdir(inputRoot);
  manager.storage.comfyInputRoot = inputRoot;
  const song = await manager.create('', 'sample-create', 'https://youtu.be/BaW_jenozKc', {
    kind: 'draft',
    style: 'Slow cinematic strings',
  });
  await manager.prepareReference(song.id);
  await manager.referenceOperations.get(song.id)?.promise;
  await manager.generate(song.id, 'lyrics', { idea: 'Reference song' });
  await idle();
  assert.match(writingRequest.prompt, /reference timing/);
  assert.match(writingRequest.prompt, /Slow cinematic strings/);
  assert.equal(song.job.input.style, 'Slow cinematic strings');
  assert.equal(writingRequest.prompt.includes(song.referenceABC), false);
  assert.match(writingRequest.prompt, /singing windows/);
  assert.equal(song.referenceLyricsGuide.sections.length, 5);
  assert.equal(song.referenceLyricsGuide.version, 1);
  assert.deepEqual(song.referenceLyricsGuide.sections[3].singing, []);
  await assert.rejects(access(path.join(writingRequest.folder, 'lyrics-prompt.txt')), {
    code: 'ENOENT',
  });
  assert.deepEqual(
    JSON.parse(await readFile(path.join(writingRequest.folder, 'reference-guide.json'), 'utf8')),
    song.referenceLyricsGuide,
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(getSongDirectory(root, song.id), 'song.json'), 'utf8'))
      .referenceLyricsGuide,
    song.referenceLyricsGuide,
  );
  song.sampleSourceUrl = song.sampleUrl;
  song.sampleFile = `EncoreSample_${song.id}_reference.mp3`;
  await writeFile(getSongFilePath(root, song, song.sampleFile), 'Reference audio');
  await writeFile(path.join(inputRoot, song.sampleFile), 'Uploaded reference');
  await store.save();
  const copy = await manager.copy(song.id);
  assert.notEqual(copy.sampleFile, song.sampleFile);
  assert.equal(copy.referenceABC, song.referenceABC);
  assert.equal(copy.referenceABCSource, copy.sampleFile);
  assert.deepEqual(copy.referenceLyricsGuide, song.referenceLyricsGuide);
  assert.equal('referenceLyricsGuide' in serializeSong(copy), false);
  await access(getSongFilePath(root, copy, copy.sampleFile));
  assert.ok(serializeSong(copy).sampleAudio);
  assert.equal('sampleFile' in serializeSong(copy), false);
  const originalSample = song.sampleFile;
  await manager.delete(song.id, song.id);
  await assert.rejects(access(path.join(inputRoot, originalSample)), { code: 'ENOENT' });
  await access(getSongFilePath(root, copy, copy.sampleFile));
  await manager.generate(copy.id, 'audio');
  await idle();
  const currentAudio = copy.audioFile;
  await assert.rejects(
    manager.generate(copy.id, 'audio', { sampleUrl: 'https://private.example/file' }),
    /YouTube video or Instagram/,
  );
  assert.equal(copy.audioFile, currentAudio);
  await access(getSongFilePath(root, copy, currentAudio));
});

test('a draft can find its reference melody without writing lyrics or replacing audio', async (t) => {
  const { root, manager, store } = await fixture(t, {
    samples: {
      ensure: async (song, job, { root, save }) => {
        song.sampleFile = `EncoreSample_${song.id}_${job.id}.mp3`;
        song.sampleSourceUrl = song.sampleUrl;
        song.sampleTitle = 'The original performance';
        const file = getSongFilePath(root, song, song.sampleFile);
        await writeFile(file, 'Reference audio');
        await save();
        return file;
      },
    },
  });
  const song = await manager.create('', 'draft-for-reference', 'https://youtu.be/BaW_jenozKc', {
    kind: 'draft',
    style: 'Dream pop',
    lyrics: '[Verse]\nA new line',
  });
  assert.equal(song.status, 'draft');
  assert.equal(song.job, null);
  assert.equal(song.style, 'Dream pop');
  const active = await manager.prepareReference(song.id);
  assert.equal(active.id, song.id);
  await manager.referenceOperations.get(song.id)?.promise;
  assert.equal(song.referencePreparation.outcome, 'complete');
  assert.equal(song.referenceABC, referenceAbc);
  assert.equal(song.referenceABCSource, song.sampleFile);
  assert.equal(song.status, 'draft');
  assert.equal(song.job, null);
  assert.equal(serializeSong(song).referencePrepared, true);
  assert.equal('referenceABC' in serializeSong(song), false);
  assert.equal(serializeSong(song).sampleTitle, 'The original performance');
  assert.equal((await openLibraryStore(root)).state.songs[0].referenceABC, referenceAbc);
  assert.equal(store.state.songs.length, 1);
});

test('an unloaded reference blocks generation without changing saved text or starting a job', async (t) => {
  const { manager } = await fixture(t);
  const song = await manager.create('', 'unloaded-reference', 'https://youtu.be/BaW_jenozKc', {
    kind: 'draft',
    style: 'Dream pop',
    lyrics: '[Verse]\nStay close',
  });
  await assert.rejects(
    manager.generate(song.id, 'audio', { style: 'New style' }),
    /Load or remove the reference audio/,
  );
  await assert.rejects(
    manager.generate(song.id, 'lyrics', { idea: 'A new idea' }),
    /Load or remove the reference audio/,
  );
  assert.equal(song.style, 'Dream pop');
  assert.equal(song.status, 'draft');
  assert.equal(song.job, null);
});

test('reference failures stay on the reference section and can be retried without losing audio', async (t) => {
  const { root, manager, renderer, idle } = await fixture(t, {
    samples: {
      ensure: async (song, job, { root, save }) => {
        song.sampleFile = `EncoreSample_${song.id}_${job.id}.mp3`;
        song.sampleSourceUrl = song.sampleUrl;
        song.sampleTitle = 'Reference recording';
        const file = getSongFilePath(root, song, song.sampleFile);
        await writeFile(file, 'Reference audio');
        await save();
        return file;
      },
    },
  });
  const song = await manager.create('First words');
  await idle();
  await manager.generate(song.id, 'audio');
  await idle();
  const audioFile = song.audioFile;
  await manager.update(song.id, { sampleUrl: 'https://youtu.be/BaW_jenozKc' });
  renderer.prepareReferenceNotation = async () => {
    throw new Error('The melody could not be read.');
  };
  await manager.prepareReference(song.id);
  await manager.referenceOperations.get(song.id)?.promise;
  assert.equal(song.referencePreparation.outcome, 'failed');
  assert.match(song.referencePreparation.error, /melody could not be read/);
  assert.equal(song.status, 'ready');
  assert.equal(song.audioFile, audioFile);
  await access(getSongFilePath(root, song, audioFile));
  renderer.prepareReferenceNotation = async (song) => {
    song.referenceABC = referenceAbc;
    song.referenceABCSource = song.sampleFile;
    return referenceAbc;
  };
  await manager.prepareReference(song.id);
  await manager.referenceOperations.get(song.id)?.promise;
  assert.equal(song.referencePreparation.outcome, 'complete');
  assert.equal(song.referencePreparation.error, undefined);
  assert.equal(song.audioFile, audioFile);
});

test('an idea becomes one persisted song, reviewed text, then playable audio with the same ID', async (t) => {
  const { root, store, manager, idle } = await fixture(t);
  const song = await manager.create('Build up the courage to say hello', 'create-one');
  assert.equal(store.state.songs.length, 1);
  assert.equal(song.idea, 'Build up the courage to say hello');
  await idle();
  assert.equal(song.status, 'draft');
  assert.equal(song.title, text.title);
  assert.equal('lyricsIdea' in song, false);
  assert.equal(serializeSong(song).audio, null);
  assert.equal((await manager.create('Ignored duplicate', 'create-one')).id, song.id);
  await manager.generate(
    song.id,
    'audio',
    { title: 'My title', style: 'Arabic hip hop', lyrics: 'My words' },
    'audio-one',
  );
  await idle();
  assert.equal(song.status, 'ready');
  assert.equal(song.job.input.style, 'Arabic hip hop');
  assert.equal(song.job.input.lyrics, 'My words');
  assert.equal(store.state.songs.length, 1);
  assert.ok(serializeSong(song).audio);
  const saved = JSON.parse(
    await readFile(path.join(getSongDirectory(root, song.id), 'song.json'), 'utf8'),
  );
  assert.equal(saved.job.id, song.job.id);
  const index = JSON.parse(await readFile(path.join(root, 'library.json'), 'utf8'));
  assert.equal('songs' in index, false);
  assert.equal('drafts' in index, false);
  assert.equal('jobs' in index, false);
  assert.deepEqual((await readdir(root)).sort(), ['library.json', 'songs']);
});

test('all saved lifecycle states have a matching studio filter while job phases remain separate', async (t) => {
  const { root, store, manager, idle, renderer } = await fixture(t);
  const allowed = new Set(songStatuses.map((item) => item.id));
  const seen = new Set();
  const phases = new Set();
  const save = store.save;
  store.save = () => {
    for (const song of store.state.songs) {
      assert.ok(allowed.has(song.status), `Unexpected song status: ${song.status}`);
      seen.add(song.status);
      if (song.job?.phase) phases.add(song.job.phase);
    }
    return save();
  };
  const song = await manager.create('A complete lifecycle');
  await idle();
  assert.equal(song.status, 'draft');
  assert.equal(song.job.outcome, 'complete');
  await manager.generate(song.id, 'audio');
  await idle();
  assert.equal(song.status, 'ready');
  renderer.executeGeneration = async () => {
    throw new Error('Render failed');
  };
  await manager.generate(song.id, 'audio');
  await idle();
  assert.equal(song.status, 'ready');
  assert.equal(song.job.outcome, 'failed');
  assert.match(song.error, /Render failed/);
  assert.deepEqual([...seen].sort(), [...allowed].sort());
  assert.ok(phases.has('queued'));
  assert.ok(phases.has('rendering'));
  const persisted = JSON.parse(
    await readFile(path.join(getSongDirectory(root, song.id), 'song.json'), 'utf8'),
  );
  assert.ok(allowed.has(persisted.status));
});

test('the submitted idea is saved on the song while writing is in progress', async (t) => {
  let release;
  let submittedPrompt;
  const { root, manager, idle } = await fixture(t, {
    writeLyrics: ({ prompt }) => {
      submittedPrompt = prompt;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const idea = 'Only use this ephemeral idea for this request';
  const song = await manager.create(idea);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.match(submittedPrompt, /Only use this ephemeral idea/);
    assert.equal(song.idea, idea);
    const persisted = await readFile(
      path.join(getSongDirectory(root, song.id), 'song.json'),
      'utf8',
    );
    assert.equal(JSON.parse(persisted).idea, idea);
    assert.equal('idea' in song.job.input, false);
  } finally {
    release(text);
  }
  await idle();
});

test('opening existing songs preserves the idea and removes old prompt files', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'encore-idea-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = getSongDirectory(root, 'legacy-song');
  const work = path.join(folder, 'work', 'old-job');
  await mkdir(work, { recursive: true });
  await writeFile(
    path.join(folder, 'song.json'),
    JSON.stringify({
      id: 'legacy-song',
      title: 'Keep this song',
      createdAt: '2026-10-01',
      status: 'ready',
      idea: 'An old saved idea',
      lyricsIdea: 'An old saved idea',
      style: 'Pop',
      genre: 'Pop',
      mood: 'Old mood',
      lyrics: 'Keep these words',
      audioFile: 'audio.mp3',
      job: {
        id: 'old-job',
        kind: 'lyrics',
        idea: 'Old idea',
        input: { idea: 'Old idea', lyrics: 'Keep these words' },
      },
    }),
  );
  await writeFile(path.join(work, 'lyrics-prompt.txt'), 'Old idea');
  await writeFile(path.join(folder, 'audio.mp3'), 'Keep this audio');
  const store = await openLibraryStore(root);
  const song = store.state.songs[0];
  assert.deepEqual(song.genres, ['Pop']);
  assert.equal('mood' in song, false);
  assert.equal('genre' in song, false);
  assert.equal(song.idea, 'An old saved idea');
  assert.equal('lyricsIdea' in song, false);
  assert.equal('idea' in song.job, false);
  assert.equal('idea' in song.job.input, false);
  assert.equal(
    (await readFile(path.join(folder, 'song.json'), 'utf8')).includes('Old idea'),
    false,
  );
  await assert.rejects(access(path.join(work, 'lyrics-prompt.txt')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(folder, 'audio.mp3'), 'utf8'), 'Keep this audio');
});

test('new audio can be composed from manually entered text and reference audio without writing lyrics first', async (t) => {
  let writes = 0;
  const { root, manager, idle, renderer } = await fixture(t, {
    writeLyrics: async () => {
      writes++;
      return text;
    },
    samples: {
      upload: async (song) => {
        const sampleFile = `EncoreSample_${song.id}_manual.mp3`;
        await writeFile(getSongFilePath(root, song, sampleFile), 'Reference');
        return { sampleFile, sampleKind: 'upload', sampleTitle: 'Reference', sampleSourceUrl: '' };
      },
      ensure: async (song) => getSongFilePath(root, song, song.sampleFile),
    },
  });
  const render = renderer.executeGeneration;
  renderer.executeGeneration = async (song, job, context) => {
    assert.ok(song.referenceABC);
    assert.equal(song.referenceABCSource, song.sampleFile);
    return render(song, job, context);
  };
  const song = await manager.create('', 'manual-audio', '', {
    kind: 'draft',
    title: 'My song',
    style: 'Indie rock',
    lyrics: '[Verse]\nMy own words',
    sampleUpload: { name: 'reference.wav', data: 'mock' },
  });
  await manager.prepareReference(song.id);
  await manager.referenceOperations.get(song.id)?.promise;
  await manager.generate(song.id, 'audio');
  await idle();
  assert.equal(song.status, 'ready', song.error);
  assert.equal(writes, 0);
  assert.equal(song.lyrics, '[Verse]\nMy own words');
  assert.equal(song.idea, '');
  await access(getSongFilePath(root, song, song.audioFile));
  await assert.rejects(
    manager.create('', 'missing-text', '', { kind: 'audio', style: 'Pop', lyrics: '' }),
    /Add lyrics to generate a song/,
  );
});

test('rewriting saves the submitted idea and preserves existing audio', async (t) => {
  const prompts = [];
  const { root, manager, idle } = await fixture(t, {
    writeLyrics: async ({ prompt }) => {
      prompts.push(prompt);
      return text;
    },
  });
  const song = await manager.create('First idea');
  await idle();
  await manager.generate(song.id, 'audio');
  await idle();
  const previous = song.audioFile;
  const master = song.masterFile;
  const previousIdea = song.lyricsIdea;
  await manager.update(song.id, { idea: 'A lucky fool named Faran' });
  assert.equal(song.lyricsIdea, previousIdea);
  assert.equal(song.idea, 'First idea');
  await manager.generate(
    song.id,
    'lyrics',
    { idea: 'A lucky fool named Faran', lyrics: '' },
    'rewrite',
  );
  await idle();
  assert.equal(song.status, 'ready');
  assert.match(prompts.at(-1), /A lucky fool named Faran/);
  assert.equal('lyricsIdea' in song, false);
  assert.equal(song.idea, 'A lucky fool named Faran');
  assert.equal('idea' in song.job.input, false);
  assert.equal(song.audioFile, previous);
  assert.equal(song.masterFile, master);
  assert.ok(serializeSong(song).audio);
  await access(getSongFilePath(root, song, previous));
  await access(getSongFilePath(root, song, master));
});

test('new lyrics preserve the existing style and audio even if the model returns a different style', async (t) => {
  const { root, manager, idle } = await fixture(t);
  const song = await manager.create('Keep moving forward');
  await idle();
  await manager.generate(song.id, 'audio');
  await idle();
  const audioFile = song.audioFile;
  const masterFile = song.masterFile;
  const idea = song.idea;
  const reference = song.sampleUrl;
  manager.writeLyrics = async () => ({
    ...text,
    style: 'Orchestral alternative rock',
    lyrics: '[Chorus]\nOne more step into the light',
  });

  await manager.generate(song.id, 'lyrics', { idea, sampleUrl: reference, lyrics: '' });
  await idle();

  assert.equal(song.status, 'ready');
  assert.equal(song.idea, idea);
  assert.equal(song.sampleUrl, reference);
  assert.equal(song.style, text.style);
  assert.equal(song.genreStyle, text.style);
  assert.equal(song.lyrics, '[Chorus]\nOne more step into the light');
  assert.ok(serializeSong(song).audio);
  assert.equal(song.audioFile, audioFile);
  assert.equal(song.masterFile, masterFile);
  for (const file of [audioFile, masterFile]) await access(getSongFilePath(root, song, file));
  const saved = JSON.parse(await readFile(path.join(root, 'songs', song.id, 'song.json'), 'utf8'));
  assert.equal(saved.lyrics, song.lyrics);
  assert.equal(saved.style, song.style);
  assert.equal(saved.audioFile, audioFile);
});

test('editing text and replacing or removing a reference saves the entity without changing its audio', async (t) => {
  const { root, manager, idle } = await fixture(t);
  const song = await manager.create('A feeling');
  await idle();
  await manager.generate(song.id, 'audio');
  await idle();
  const media = {
    audioFile: song.audioFile,
    masterFile: song.masterFile,
    audioVersion: song.audioVersion,
    duration: song.duration,
  };
  for (const edits of [
    { style: 'New sound', lyrics: '[Verse]\nNew words' },
    { sampleUrl: 'https://youtu.be/BaW_jenozKc' },
    { sampleUrl: '', removeSample: true },
    { style: '', lyrics: '' },
  ]) {
    await manager.update(song.id, edits);
    assert.equal(song.status, 'ready');
    for (const [key, value] of Object.entries(media)) assert.equal(song[key], value);
    for (const file of [media.audioFile, media.masterFile])
      await access(getSongFilePath(root, song, file));
    const saved = JSON.parse(
      await readFile(path.join(getSongDirectory(root, song.id), 'song.json'), 'utf8'),
    );
    assert.equal(saved.style, song.style);
    assert.equal(saved.lyrics, song.lyrics);
    assert.equal(saved.sampleUrl, song.sampleUrl);
    assert.equal(saved.audioFile, media.audioFile);
  }
});

test('a successful replacement keeps the previous files until new audio is committed', async (t) => {
  const { root, manager, idle, renderer } = await fixture(t);
  const song = await manager.create('A feeling');
  await idle();
  await manager.generate(song.id, 'audio');
  await idle();
  const previous = [song.audioFile, song.masterFile];
  const render = renderer.executeGeneration;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  renderer.executeGeneration = async (current, job, context) => {
    for (const file of previous) await access(getSongFilePath(root, current, file));
    await gate;
    await render(current, job, context);
  };
  await manager.generate(song.id, 'audio', { style: 'New sound', lyrics: 'New words' });
  try {
    assert.equal(song.audioFile, previous[0]);
    assert.ok(serializeSong(song).audio);
    for (const file of previous) await access(getSongFilePath(root, song, file));
  } finally {
    release();
  }
  await idle();
  assert.equal(song.status, 'ready');
  assert.notEqual(song.audioFile, previous[0]);
  await access(getSongFilePath(root, song, song.audioFile));
  for (const file of previous)
    await assert.rejects(access(getSongFilePath(root, song, file)), { code: 'ENOENT' });
});

test('cancelled replacement removes partial files and keeps the previous audio after restart', async (t) => {
  const { root, manager, idle, renderer } = await fixture(t);
  const song = await manager.create('A feeling');
  await idle();
  await manager.generate(song.id, 'audio');
  await idle();
  const previous = song.audioFile;
  let started;
  const rendering = new Promise((resolve) => {
    started = resolve;
  });
  let partial;
  renderer.executeGeneration = async (current, job, { signal }) => {
    partial = `master-${job.id}.wav`;
    await writeFile(getSongFilePath(root, current, partial), 'Incomplete render');
    started();
    await new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  };
  await manager.generate(song.id, 'audio', { style: 'New sound' });
  await rendering;
  await manager.cancel(song.id);
  await idle();
  assert.equal(song.status, 'ready');
  assert.equal(song.job.outcome, 'cancelled');
  assert.equal(song.audioFile, previous);
  await access(getSongFilePath(root, song, previous));
  await assert.rejects(access(getSongFilePath(root, song, partial)), { code: 'ENOENT' });
  const restored = (await openLibraryStore(root)).state.songs[0];
  assert.equal(restored.audioFile, previous);
  assert.equal(restored.style, 'New sound');
  assert.equal(restored.status, 'ready');
});

test('copies own their media and cover; editing or deleting either song leaves the other intact', async (t) => {
  const { root, store, manager, idle } = await fixture(t);
  const original = await manager.create('A feeling');
  await idle();
  await manager.generate(original.id, 'audio');
  await idle();
  const copy = await manager.copy(original.id, 'copy-one');
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.title, original.title + ' 2');
  assert.equal(copy.idea, original.idea);
  assert.equal(copy.job, null);
  assert.deepEqual(copy.renderIds, []);
  assert.equal((await manager.copy(original.id, 'copy-one')).id, copy.id);
  await manager.generate(copy.id, 'audio', { lyrics: 'Different words', style: 'Different sound' });
  await idle();
  assert.notEqual(copy.lyrics, original.lyrics);
  store.state.playlists.push({ id: 'playlist', songIds: [original.id, copy.id] });
  const deleted = await manager.delete(original.id, original.id);
  assert.equal(deleted.cleanupPending, false);
  await assert.rejects(access(getSongDirectory(root, original.id)), { code: 'ENOENT' });
  assert.equal(
    await readFile(getSongFilePath(root, copy, copy.audioFile), 'utf8'),
    'Independent audio',
  );
  await access(getSongFilePath(root, copy, copy.coverFile));
  assert.deepEqual(store.state.playlists[0].songIds, [copy.id]);
  assert.equal((await openLibraryStore(root)).state.songs[0].id, copy.id);
  assert.equal((await manager.delete(original.id, original.id)).deleted, true);
});

test('regeneration deduplicates requests and failure preserves the current audio', async (t) => {
  const { root, manager, idle, renderer } = await fixture(t);
  const song = await manager.create('A feeling');
  await idle();
  await manager.generate(song.id, 'audio', {}, 'first');
  await idle();
  const previous = song.audioFile;
  renderer.executeGeneration = async () => {
    throw new Error('GPU needs a rest');
  };
  await manager.generate(song.id, 'audio', { style: 'Epic strings' }, 'failed');
  const id = song.job.id;
  await idle();
  await manager.generate(song.id, 'audio', {}, 'failed');
  assert.equal(song.job.id, id);
  assert.equal(song.status, 'ready');
  assert.equal(song.job.outcome, 'failed');
  assert.equal(song.audioFile, previous);
  assert.ok(serializeSong(song).audio);
  await access(getSongFilePath(root, song, previous));
  assert.equal(song.style, 'Epic strings');
  assert.match(song.error, /GPU/);
});

test('audio text is durable and previous media remains playable while composing', async (t) => {
  const { root, store, manager, idle, renderer } = await fixture(t);
  const song = await manager.create('Saved idea');
  await idle();
  await manager.generate(song.id, 'audio');
  await idle();
  const audio = song.audioFile,
    master = song.masterFile;
  renderer.executeGeneration = async (current, job) => {
    assert.equal(current.idea, 'Saved idea');
    assert.equal('idea' in job.input, false);
    assert.equal(current.audioFile, audio);
    const saved = JSON.parse(
      await readFile(path.join(getSongDirectory(root, current.id), 'song.json'), 'utf8'),
    );
    assert.equal(saved.style, 'Edited style');
    assert.equal(saved.lyrics, 'Edited lyrics');
    assert.equal(saved.audioFile, audio);
    await access(getSongFilePath(root, current, audio));
    await access(getSongFilePath(root, current, master));
    throw new Error('Stop after checking order');
  };
  await manager.generate(song.id, 'audio', {
    idea: 'Do not commit this idea',
    title: 'Edited title',
    lyrics: 'Edited lyrics',
    style: 'Edited style',
  });
  await idle();
  assert.match(song.error, /Stop after checking order/);
  assert.equal(store.state.songs.length, 1);
});

test('failed lyrics generation preserves the request idea, saved edits, and audio', async (t) => {
  const { root, manager, idle } = await fixture(t);
  const song = await manager.create('Saved idea');
  await idle();
  await manager.generate(song.id, 'audio');
  await idle();
  const audio = song.audioFile;
  let release;
  manager.writeLyrics = () =>
    new Promise((_resolve, reject) => {
      release = reject;
    });
  await manager.generate(song.id, 'lyrics', {
    idea: 'New ungenerated idea',
    style: 'My edited style',
  });
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(song.idea, 'New ungenerated idea');
  assert.equal('idea' in song.job.input, false);
  release(new Error('Writing did not finish'));
  await idle();
  assert.equal(song.idea, 'New ungenerated idea');
  assert.equal(song.style, 'My edited style');
  assert.equal(song.lyrics, text.lyrics);
  await access(getSongFilePath(root, song, audio));
});

test('a running song is cancelled and settled before its entire folder is deleted', async (t) => {
  const { root, manager, idle, renderer } = await fixture(t);
  const song = await manager.create('A feeling');
  await idle();
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  renderer.executeGeneration = async (_song, _job, { signal, update }) => {
    await update('rendering');
    started();
    await new Promise((resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  };
  await manager.generate(song.id, 'audio');
  await ready;
  await assert.rejects(
    manager.update(song.id, { title: 'Unsafe mid-render edit' }),
    /Stop generation/,
  );
  await assert.rejects(manager.delete(song.id, 'wrong'), /Confirm/);
  await access(getSongDirectory(root, song.id));
  await manager.delete(song.id, song.id);
  await assert.rejects(access(getSongDirectory(root, song.id)), { code: 'ENOENT' });
  assert.equal(manager.activeSongId, null);
});

test('queued songs can be cancelled without running and later songs still progress', async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { root, manager, idle } = await fixture(t, {
    writeLyrics: async () => {
      await gate;
      return text;
    },
  });
  const first = await manager.create('First');
  const second = await manager.create('Second');
  await manager.cancel(second.id);
  release();
  await idle();
  assert.equal(first.status, 'draft');
  assert.equal(second.status, 'draft');
  assert.equal(second.job.outcome, 'cancelled');
  assert.equal(second.job.startedAt, undefined);
  assert.equal(
    (await openLibraryStore(root)).state.songs.find((song) => song.id === second.id).status,
    'draft',
  );
});

test('restart recovery keeps one song record and marks interrupted work for review', async (t) => {
  const { root, store, manager, idle } = await fixture(t);
  const song = await manager.create('A feeling');
  await idle();
  song.status = 'rendering';
  song.job.promptId = 'unfinished-render';
  await store.save();
  const restored = await openLibraryStore(root);
  assert.equal(restored.state.songs.length, 1);
  assert.equal(restored.state.songs[0].status, 'draft');
  assert.equal(restored.state.songs[0].job.outcome, 'failed');
  assert.equal(restored.state.songs[0].job.promptId, 'unfinished-render');
  assert.match(restored.state.songs[0].error, /restarted/);
});

test('folder deletion rejects traversal and does not touch neighboring files', async (t) => {
  const { root } = await fixture(t);
  const outside = path.join(root, 'keep.txt');
  await writeFile(outside, 'Keep');
  await assert.rejects(removeSongFolder(root, '..'), /Invalid item/);
  assert.equal(await readFile(outside, 'utf8'), 'Keep');
});

test('a failed save can recover and a fresh studio has no catalogs', async (t) => {
  const { root, store } = await fixture(t);
  assert.deepEqual(store.state.songs, []);
  assert.deepEqual(store.state.playlists, []);
  await mkdir(path.join(root, 'library.json.tmp'));
  await assert.rejects(store.save());
  await rm(path.join(root, 'library.json.tmp'), { recursive: true });
  store.state.playlists.push({ id: 'one', songIds: [] });
  await store.save();
  assert.equal((await openLibraryStore(root)).state.playlists[0].id, 'one');
});

test('an uploaded reference remains one song-owned file shared by writing and rendering', async (t) => {
  const writingRequests = [];
  const { root, manager, renderer, idle } = await fixture(t, {
    writeLyrics: async (request) => {
      writingRequests.push(request);
      return text;
    },
  });
  manager.samples = new ReferenceAudioStore();
  const bytes = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-f', 'wav', 'pipe:1'],
    { windowsHide: true },
  );
  const upload = { name: 'My inspiration.wav', data: bytes.toString('base64') };
  const song = await manager.create('A song with a reference', 'uploaded-reference', '', {
    kind: 'draft',
    sampleUpload: upload,
  });
  await manager.prepareReference(song.id);
  await manager.referenceOperations.get(song.id)?.promise;
  await manager.generate(song.id, 'lyrics', { idea: 'A song with a reference' });
  await idle();
  assert.equal(song.status, 'draft', song.error);
  assert.equal(song.sampleKind, 'upload');
  const file = getSongFilePath(root, song, song.sampleFile);
  assert.match(writingRequests[0].prompt, /reference timing/);
  assert.equal(writingRequests[0].prompt.includes(song.referenceABC), false);
  assert.doesNotMatch(JSON.stringify(song), /"sampleUpload"/);
  await manager.generate(song.id, 'lyrics', {
    idea: 'A different story with the same reference',
    lyrics: '',
  });
  await idle();
  assert.match(writingRequests[1].prompt, /reference timing/);
  assert.equal(writingRequests[1].prompt.includes(song.referenceABC), false);
  const originalRender = renderer.executeGeneration;
  let renderReference;
  renderer.executeGeneration = async (item, job, context) => {
    renderReference = item.referenceABC;
    return originalRender(item, job, context);
  };
  await manager.generate(song.id, 'audio');
  await idle();
  assert.equal(renderReference, song.referenceABC);
  assert.equal(song.status, 'ready', song.error);
  const referenceFiles = (await readdir(getSongDirectory(root, song.id))).filter((name) =>
    name.startsWith('EncoreSample_'),
  );
  assert.deepEqual(referenceFiles, [song.sampleFile]);
  await assert.rejects(
    manager.generate(song.id, 'lyrics', {
      sampleUrl: 'https://youtu.be/BaW_jenozKc',
      sampleUpload: upload,
    }),
    /Load or remove the reference audio/,
  );
  assert.equal(song.sampleFile, referenceFiles[0]);
  await manager.generate(song.id, 'lyrics', { removeSample: true, sampleUrl: '', lyrics: '' });
  await idle();
  assert.doesNotMatch(writingRequests.at(-1).prompt, /reference timing|singing windows/);
  assert.equal(song.referenceABC, undefined);
  assert.equal(song.referenceLyricsGuide, undefined);
  assert.equal(song.sampleFile, undefined);
  await assert.rejects(access(file), { code: 'ENOENT' });
});

test('an unsupported reference score stops before Codex and preserves the existing text and audio', async (t) => {
  let writingCalls = 0;
  let transcriptionCalls = 0;
  const { root, manager, idle } = await fixture(t, {
    writeLyrics: async () => {
      writingCalls++;
      return text;
    },
    samples: {
      ensure: async (song, job, context) => {
        song.sampleFile = `EncoreSample_${song.id}_reference.mp3`;
        song.sampleSourceUrl = job.input.sampleUrl;
        const file = getSongFilePath(context.root, song, song.sampleFile);
        await writeFile(file, 'Reference');
        return file;
      },
    },
  });
  const song = await manager.create('Keep this original idea');
  await idle();
  await manager.generate(song.id, 'audio');
  await idle();
  const audioFile = song.audioFile;
  assert.ok(audioFile);
  manager.renderer.prepareReferenceNotation = async (song) => {
    transcriptionCalls++;
    song.referenceABC = 'Unsupported notation';
    song.referenceABCSource = song.sampleFile;
    return song.referenceABC;
  };
  await manager.update(song.id, { sampleUrl: 'https://youtu.be/BaW_jenozKc' });
  await manager.prepareReference(song.id);
  await manager.referenceOperations.get(song.id)?.promise;
  assert.equal(song.status, 'ready');
  assert.equal(song.referencePreparation.outcome, 'complete');
  await manager.generate(song.id, 'lyrics', { idea: 'A new idea', lyrics: '' });
  await idle();
  assert.equal(song.job.outcome, 'failed');
  assert.match(song.error, /reference score could not be analyzed/);
  assert.equal(writingCalls, 1);
  assert.equal(transcriptionCalls, 1);
  assert.equal(song.idea, 'A new idea');
  assert.equal(song.lyrics, '');
  assert.equal(song.audioFile, audioFile);
  assert.equal(song.referenceLyricsGuide, undefined);
  await access(getSongFilePath(root, song, audioFile));
});

test('a failed reference rewrite retains the saved guide and records the attempted guide separately', async (t) => {
  const { manager, idle } = await fixture(t, {
    samples: {
      ensure: async (song) => {
        song.sampleFile = 'reference.mp3';
        song.sampleSourceUrl = song.sampleUrl;
        return 'reference.mp3';
      },
    },
  });
  const song = await manager.create('', 'plan-provenance', 'https://youtu.be/BaW_jenozKc', {
    kind: 'draft',
  });
  await manager.prepareReference(song.id);
  await manager.referenceOperations.get(song.id)?.promise;
  await manager.generate(song.id, 'lyrics', { idea: 'Original story' });
  await idle();
  const savedPlan = structuredClone(song.referenceLyricsGuide);
  savedPlan.version = 2;
  song.referenceLyricsGuide = savedPlan;
  let calls = 0;
  manager.writeLyrics = async (request) => {
    calls++;
    assert.deepEqual(song.referenceLyricsGuide, savedPlan);
    const attempted = JSON.parse(
      await readFile(path.join(request.folder, 'reference-guide.json'), 'utf8'),
    );
    assert.equal(attempted.version, 1);
    throw new Error('Writing stopped');
  };
  await manager.generate(song.id, 'lyrics', { idea: 'A new story', style: 'A new style' });
  await idle();
  assert.equal(calls, 1);
  assert.equal(song.status, 'draft');
  assert.equal(song.job.outcome, 'failed');
  assert.equal(song.idea, 'A new story');
  assert.equal(song.lyrics, text.lyrics);
  assert.deepEqual(song.referenceLyricsGuide, savedPlan);
});
