import { randomUUID } from 'node:crypto';
import { defaultProfileId, requireProfile, ownerProfileId } from '../profiles/profile-records.mjs';
import { mkdir, copyFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { writeLyricsWithCodex } from '../generation/lyrics/codex-runner.mjs';
import { createSongCompletionPrompt } from '../generation/lyrics/song-completion-prompt.mjs';
import {
  createSongCompletionSchema,
  saveResponseSchema,
} from '../generation/lyrics/song-completion-schema.mjs';
import { createReferenceLyricsGuide } from '../generation/lyrics/reference-lyrics-guide.mjs';
import { getIdleSongStatus } from './song-status.js';
import { createCoverArtwork } from '../library/cover-artwork.mjs';
import { RequestError, requireSafeId } from '../server/request-security.mjs';
import {
  isSongGenerating,
  getSongFilePath,
  getSongDirectory,
  getSongGenerationInput,
  hasLoadedReference,
} from './song-record.mjs';
import {
  cleanupUnusedSongAudio,
  clearSongSample,
  finishSongCleanup,
  removeSongFolder,
} from './song-file-cleanup.mjs';
import {
  normalizeReferenceUrl,
  ReferenceAudioStore,
} from '../generation/reference-audio-store.mjs';

export class SongService {
  #operations = Promise.resolve();
  constructor({
    store,
    renderer,
    codex = 'codex',
    writeLyrics = writeLyricsWithCodex,
    writeMetadata = writeLyricsWithCodex,
    storage = {},
    samples = renderer.samples || new ReferenceAudioStore(),
  }) {
    Object.assign(this, {
      store,
      renderer,
      codex,
      writeLyrics,
      writeMetadata,
      storage,
      samples,
    });
    this.activeSongId = null;
    this.generationPromise = null;
    this.activeProcess = null;
    this.referenceOperations = new Map();
  }

  runExclusive(operation) {
    const pending = this.#operations.catch(() => {}).then(operation);
    this.#operations = pending;
    return pending;
  }

  cleanup() {
    return this.runExclusive(() => finishSongCleanup(this.store, this.storage));
  }

  cleanupPendingFiles() {
    return finishSongCleanup(this.store, this.storage);
  }

  get(id) {
    const song = this.store.state.songs.find((item) => item.id === requireSafeId(id));
    if (!song) throw new RequestError(404, 'Song not found.');
    return song;
  }

  requireEditableSong(song, input) {
    if (
      ((isSongGenerating(song) || this.activeSongId === song.id) &&
        ['title', 'style', 'lyrics', 'sampleUrl', 'sampleUpload', 'removeSample'].some(
          (key) => input[key] !== undefined,
        )) ||
      (song.referencePreparation?.phase &&
        ['sampleUrl', 'sampleUpload', 'removeSample'].some((key) => input[key] !== undefined))
    )
      throw new RequestError(409, 'Stop generation before editing this song.');
  }

  create(
    idea,
    requestId = randomUUID(),
    referenceUrl = '',
    reference = {},
    profileId = defaultProfileId,
  ) {
    return this.runExclusive(async () => {
      requireProfile(this.store, profileId);
      if (this.store.state.deletedSongRequests?.[`${profileId}:${requestId}`])
        throw new RequestError(410, 'This song was deleted.');
      const prior = this.store.state.songs.find(
        (song) => song.requestId === requestId && ownerProfileId(song) === profileId,
      );
      if (prior) return prior;
      const id = randomUUID();
      const exploring = reference.kind === 'explore';
      const kind = exploring
        ? 'audio'
        : ['audio', 'draft'].includes(reference.kind)
          ? reference.kind
          : 'lyrics';
      if (kind !== 'draft' && (referenceUrl || reference.sampleUpload))
        throw new RequestError(400, 'Load or remove the reference audio before generating.');
      if (kind === 'audio' && !exploring) this.requireSongLyrics(reference.lyrics);
      const song = {
        id,
        profileId,
        requestId,
        title: reference.title?.trim() || '',
        idea: kind === 'lyrics' || exploring ? idea : '',
        ...(exploring ? { temporary: true, exploreSession: reference.exploreSession } : {}),
        style: reference.style || '',
        lyrics: reference.lyrics || '',
        sampleUrl: normalizeReferenceUrl(referenceUrl),
        genres: [],
        status: 'draft',
        liked: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        coverFile: 'cover.svg',
        job: null,
        requests: [],
        renderIds: [],
      };
      await mkdir(getSongDirectory(this.store.root, id), { recursive: true });
      try {
        await this.setReference(song, {
          ...reference,
          sampleUrl: referenceUrl,
        });
      } catch (error) {
        await removeSongFolder(this.store.root, song.id);
        throw error;
      }
      await writeFile(
        getSongFilePath(this.store.root, song, song.coverFile),
        createCoverArtwork({
          id,
          title: song.title,
          subtitle: 'ENCORE ORIGINAL',
          seed: id,
        }),
      );
      this.store.state.songs.unshift(song);
      await this.store.save();
      if (kind === 'draft') return song;
      return this.queueGeneration(song, kind, requestId, getSongGenerationInput(song));
    });
  }

  update(id, edits) {
    return this.runExclusive(async () => {
      const song = this.get(id);
      this.requireEditableSong(song, edits);
      if (edits.baseRevision !== undefined && edits.baseRevision !== (song.editRevision || 0))
        throw new RequestError(
          409,
          'This song changed on another device. Your edits have been kept.',
        );
      if (typeof edits.liked === 'boolean') song.liked = edits.liked;
      await this.applyEdits(song, edits);
      if (
        ['title', 'style', 'lyrics', 'sampleUrl', 'sampleUpload', 'removeSample'].some(
          (key) => edits[key] !== undefined,
        )
      )
        song.editRevision = (song.editRevision || 0) + 1;
      await this.store.save();
      return song;
    });
  }

  saveExploration(id, onSave = () => {}) {
    return this.runExclusive(async () => {
      const song = this.get(id);
      if (!song.audioFile) throw new RequestError(409, 'Wait for this song to finish generating.');
      song.exploreDecision = { sessionId: song.exploreSession, action: 'keep' };
      delete song.temporary;
      delete song.exploreSession;
      song.updatedAt = new Date().toISOString();
      onSave();
      await this.store.save();
      return song;
    });
  }

  discardExploration(id) {
    return this.runExclusive(() => {
      if (!this.get(id).temporary)
        throw new RequestError(409, 'This song is already in your library.');
      return this.deleteSong(id, id);
    });
  }

  generate(id, kind, edits = {}, requestId = randomUUID()) {
    return this.runExclusive(async () => {
      const song = this.get(id);
      if (song.requests.includes(`${kind}:${requestId}`)) return song;
      if (edits.baseRevision !== undefined && edits.baseRevision !== (song.editRevision || 0))
        throw new RequestError(
          409,
          'This song changed on another device. Your edits have been kept.',
        );
      if (song.referencePreparation?.phase)
        throw new RequestError(409, 'Wait for reference preparation to finish.');
      this.requireEditableSong(song, { lyrics: song.lyrics });
      const selectedUrl = normalizeReferenceUrl(edits.sampleUrl ?? song.sampleUrl);
      if (
        !edits.removeSample &&
        (selectedUrl || edits.sampleUpload || song.sampleKind === 'upload') &&
        (edits.sampleUpload || selectedUrl !== song.sampleUrl || !hasLoadedReference(song))
      )
        throw new RequestError(400, 'Load or remove the reference audio before generating.');
      // A render left running after a restart must be stopped before a new one.
      if (song.job?.promptId && song.job.outcome !== 'complete') await this.renderer.stop(song.job);
      if (kind === 'audio') {
        const lyrics = edits.lyrics ?? song.lyrics;
        this.requireSongLyrics(lyrics);
      }
      await this.applyEdits(song, edits);
      if (kind === 'lyrics' && typeof edits.idea === 'string') song.idea = edits.idea;
      return this.queueGeneration(song, kind, requestId, getSongGenerationInput(song));
    });
  }

  requireSongLyrics(lyrics) {
    if (typeof lyrics !== 'string' || !lyrics.trim())
      throw new RequestError(400, 'Add lyrics to generate a song.');
  }

  applyCompletedDetails(song, schema, result) {
    song.editRevision = (song.editRevision || 0) + 1;
    const completed = {};
    for (const field of schema.required) {
      if (field === 'genres') {
        const genres = Array.isArray(result.genres)
          ? [
              ...new Set(
                result.genres
                  .filter((value) => typeof value === 'string')
                  .map((value) => value.trim())
                  .filter(Boolean),
              ),
            ]
          : [];
        if (!genres.length) throw new Error('Could not complete the genre tags. Try again.');
        completed.genres = genres;
      } else if (typeof result[field] !== 'string' || !result[field].trim()) {
        throw new Error(`Could not complete the song ${field}. Try again.`);
      } else completed[field] = result[field];
    }
    Object.assign(song, completed);
    if (schema.properties.genres) song.genreStyle = song.style;
  }

  async setReference(song, edits) {
    const referenceUrl = normalizeReferenceUrl(
      edits.sampleUrl ?? (edits.sampleUpload ? '' : song.sampleUrl) ?? '',
    );
    if (edits.sampleUpload && referenceUrl)
      throw new RequestError(400, 'Choose either an audio file or a video link.');
    let uploaded;
    if (edits.sampleUpload) {
      uploaded = await this.samples.upload(song, edits.sampleUpload, {
        root: this.store.root,
        folder: getSongDirectory(this.store.root, song.id),
      });
    }
    if (uploaded || edits.removeSample || referenceUrl !== (song.sampleUrl || '')) {
      try {
        await clearSongSample(this.store, song, this.storage);
      } catch (error) {
        if (uploaded)
          await unlink(getSongFilePath(this.store.root, song, uploaded.sampleFile)).catch(() => {});
        throw error;
      }
      song.sampleUrl = edits.removeSample ? '' : referenceUrl;
      song.sampleKind = song.sampleUrl ? 'link' : '';
      if (uploaded) Object.assign(song, uploaded);
      delete song.referencePreparation;
    }
  }

  async applyEdits(song, edits) {
    const fields = ['title', 'style', 'lyrics'];
    const hasReference = ['sampleUrl', 'sampleUpload', 'removeSample'].some(
      (key) => edits[key] !== undefined,
    );
    if (hasReference) await this.setReference(song, edits);
    let changed = hasReference;
    for (const key of fields) {
      if (typeof edits[key] !== 'string' || edits[key] === song[key]) continue;
      if (key === 'lyrics' && song.lyrics?.trim()) song.previousLyrics = song.lyrics;
      song[key] = edits[key];
      changed = true;
    }
    if (changed) song.updatedAt = new Date().toISOString();
  }

  prepareReference(id, requestId = randomUUID()) {
    return this.runExclusive(async () => {
      const song = this.get(id);
      if (song.referencePreparation?.phase) return song;
      this.requireEditableSong(song, { sampleUrl: song.sampleUrl });
      if (!song.sampleUrl && song.sampleKind !== 'upload')
        throw new RequestError(400, 'Add reference audio before preparing it.');
      if (song.referenceABC && song.referenceABCSource === song.sampleFile) return song;
      if (song.referencePreparation?.promptId && song.referencePreparation.outcome !== 'complete')
        await this.renderer.stop(song.referencePreparation);
      const job = {
        id: randomUUID(),
        requestId,
        input: { sampleUrl: song.sampleUrl },
        phase: 'downloading',
        startedAt: new Date().toISOString(),
      };
      song.referencePreparation = job;
      song.renderIds.push(job.id);
      song.updatedAt = new Date().toISOString();
      await this.store.save();
      const operation = {
        controller: new AbortController(),
        process: null,
        promise: null,
      };
      operation.promise = this.executeReferencePreparation(song, job, operation)
        .catch(async (error) => {
          job.outcome = operation.controller.signal.aborted ? 'cancelled' : 'failed';
          if (!operation.controller.signal.aborted) job.error = error.message;
          delete job.phase;
          job.finishedAt = new Date().toISOString();
          song.updatedAt = job.finishedAt;
          await this.store.save();
        })
        .finally(() => this.referenceOperations.delete(song.id));
      this.referenceOperations.set(song.id, operation);
      operation.promise.catch((error) =>
        console.error('Reference preparation could not be saved:', error.message),
      );
      return song;
    });
  }

  async executeReferencePreparation(song, job, operation) {
    const signal = operation.controller.signal;
    const folder = path.join(getSongDirectory(this.store.root, song.id), 'work', job.id);
    await mkdir(folder, { recursive: true });
    const update = async (phase) => {
      signal.throwIfAborted();
      job.phase = phase;
      song.updatedAt = new Date().toISOString();
      await this.store.save();
    };
    const sampleFile = await this.samples.ensure(song, job, {
      root: this.store.root,
      folder,
      signal,
      save: () => this.store.save(),
      onStart: (process) => {
        operation.process = process;
        if (signal.aborted) process.kill();
      },
    });
    if (!sampleFile) throw new Error('The reference audio is unavailable.');
    await this.renderer.prepareReferenceNotation(song, job, {
      sampleFile,
      folder,
      signal,
      update,
      save: () => this.store.save(),
    });
    signal.throwIfAborted();
    job.outcome = 'complete';
    delete job.phase;
    job.finishedAt = new Date().toISOString();
    song.updatedAt = job.finishedAt;
    await this.store.save();
  }

  async queueGeneration(song, kind, requestId, input = getSongGenerationInput(song)) {
    song.job = {
      id: randomUUID(),
      kind,
      requestId,
      input,
      queuedAt: new Date().toISOString(),
      phase: 'queued',
    };
    song.requests.push(`${kind}:${requestId}`);
    if (kind === 'audio' || input.sampleUrl || song.sampleKind === 'upload')
      song.renderIds.push(song.job.id);
    song.status = kind;
    delete song.error;
    await this.store.save();
    this.processNextSong();
    return song;
  }

  copy(id, requestId = randomUUID()) {
    return this.runExclusive(async () => {
      const original = this.get(id);
      const prior = this.store.state.songs.find(
        (song) => song.requestId === requestId && ownerProfileId(song) === ownerProfileId(original),
      );
      if (prior) return prior;
      this.requireEditableSong(original, { lyrics: original.lyrics });
      const names = new Set(
        this.store.state.songs
          .filter((item) => ownerProfileId(item) === ownerProfileId(original))
          .map((item) => (item.title || '').trim().toLocaleLowerCase()),
      );
      const originalTitle = original.title?.trim() || 'Untitled song';
      const numbered = originalTitle.match(/^(.*?) (\d+)$/);
      const base =
        numbered && names.has(numbered[1].toLocaleLowerCase()) ? numbered[1] : originalTitle;
      let number = numbered && base !== originalTitle ? Math.max(2, Number(numbered[2]) + 1) : 2;
      while (names.has(`${base} ${number}`.toLocaleLowerCase())) number++;
      const song = {
        ...structuredClone(original),
        id: randomUUID(),
        requestId,
        title: `${base} ${number}`,
        job: null,
        requests: [],
        renderIds: [],
        pendingAudioFiles: [],
        liked: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      song.status = getIdleSongStatus(song);
      delete song.error;
      delete song.referencePreparation;
      await mkdir(getSongDirectory(this.store.root, song.id), {
        recursive: true,
      });
      for (const relative of [song.audioFile, song.masterFile, song.coverFile].filter(Boolean))
        await copyFile(
          getSongFilePath(this.store.root, original, relative),
          getSongFilePath(this.store.root, song, relative),
        );
      if (original.sampleFile) {
        song.sampleFile = `EncoreSample_${song.id}_${randomUUID()}.mp3`;
        if (original.referenceABCSource === original.sampleFile)
          song.referenceABCSource = song.sampleFile;
        await copyFile(
          getSongFilePath(this.store.root, original, original.sampleFile),
          getSongFilePath(this.store.root, song, song.sampleFile),
        );
      }
      this.store.state.songs.unshift(song);
      await this.store.save();
      return song;
    });
  }

  cancel(id) {
    return this.runExclusive(async () => {
      const song = this.get(id);
      await this.stop(song);
      return song;
    });
  }

  async stop(song) {
    const referenceOperation = this.referenceOperations.get(song.id);
    if (referenceOperation) {
      referenceOperation.controller.abort();
      referenceOperation.process?.kill();
      await referenceOperation.promise;
    }
    if (song.referencePreparation?.promptId && song.referencePreparation.outcome !== 'complete')
      await this.renderer.stop(song.referencePreparation);
    if (
      !isSongGenerating(song) &&
      this.activeSongId !== song.id &&
      !(song.job?.promptId && song.job.outcome !== 'complete')
    )
      return;
    if (song.job?.phase === 'queued' && this.activeSongId !== song.id) {
      song.status = getIdleSongStatus(song);
      delete song.job.phase;
    }
    if (this.activeSongId === song.id) {
      this.generationAbortController.abort();
      this.activeProcess?.kill();
      await this.generationPromise;
    }
    await this.renderer.stop(song.job);
    song.status = getIdleSongStatus(song);
    song.updatedAt = new Date().toISOString();
    if (song.job) {
      song.job.finishedAt = new Date().toISOString();
      song.job.outcome = 'cancelled';
      delete song.job.phase;
    }
    await this.store.save();
  }

  delete(id, confirmation) {
    return this.runExclusive(() => this.deleteSong(id, confirmation));
  }

  async deleteSong(id, confirmation) {
    requireSafeId(id);
    if (confirmation !== id) throw new RequestError(400, 'Confirm this song before deleting it.');
    const song = this.store.state.songs.find((song) => song.id === id);
    if (!song && !this.store.state.deletedSongIds.includes(id))
      throw new RequestError(404, 'Song not found.');
    if (song) {
      await this.stop(song);
      const before = structuredClone(this.store.state);
      this.store.state.songs = this.store.state.songs.filter((song) => song.id !== id);
      for (const playlist of this.store.state.playlists) {
        if (playlist.songIds.includes(id)) playlist.editRevision = (playlist.editRevision || 0) + 1;
        playlist.songIds = playlist.songIds.filter((songId) => songId !== id);
      }
      this.store.state.deletedSongRequests ||= {};
      this.store.state.deletedSongRequests[`${ownerProfileId(song)}:${song.requestId}`] = id;
      this.store.state.deletedSongIds.push(id);
      this.store.state.deletedSongProfiles[id] = ownerProfileId(song);
      this.store.state.pendingSongDeletions.push({
        id,
        profileId: ownerProfileId(song),
        jobIds: song.renderIds,
        sampleFiles: [song.sampleFile].filter(Boolean),
      });
      try {
        await this.store.save();
      } catch (error) {
        Object.assign(this.store.state, before);
        throw error;
      }
    }
    await finishSongCleanup(this.store, this.storage);
    return {
      deleted: true,
      id,
      cleanupPending: this.store.state.pendingSongDeletions.some((entry) => entry.id === id),
    };
  }

  processNextSong() {
    if (this.activeSongId) return;
    const song = [...this.store.state.songs]
      .reverse()
      .filter((song) => isSongGenerating(song) && song.job?.phase === 'queued')
      .sort((a, b) => a.job.queuedAt.localeCompare(b.job.queuedAt))[0];
    if (!song) return;
    this.activeSongId = song.id;
    this.generationAbortController = new AbortController();
    const signal = this.generationAbortController.signal;
    this.generationPromise = this.executeGeneration(song, signal)
      .catch(async (error) => {
        if (song.job.kind === 'audio')
          await cleanupUnusedSongAudio(this.store, song).catch(() => {});
        song.status = getIdleSongStatus(song);
        song.job.outcome = signal.aborted ? 'cancelled' : 'failed';
        delete song.job.phase;
        song.updatedAt = new Date().toISOString();
        if (!signal.aborted) song.error = error.message;
        song.job.finishedAt = new Date().toISOString();
        await this.store.save();
      })
      .finally(() => {
        this.activeSongId = null;
        this.activeProcess = null;
        this.generationPromise = null;
        this.processNextSong();
      });
    this.generationPromise.catch((error) =>
      console.error('Song generation could not be saved:', error.message),
    );
  }

  getLyricsToAvoid(song) {
    const recent = this.store.state.songs
      .filter((item) => item.id !== song.id && ownerProfileId(item) === ownerProfileId(song))
      .sort((a, b) =>
        (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''),
      );
    const unique = [
      ...new Set(
        [song.previousLyrics, ...recent.map((item) => item.lyrics || item.previousLyrics)]
          .filter((lyrics) => typeof lyrics === 'string' && lyrics.trim())
          .map((lyrics) => lyrics.trim()),
      ),
    ];
    // Keep prior songs useful as contrast without allowing history to dominate the prompt.
    let remaining = 30000;
    return unique.slice(0, 5).flatMap((lyrics) => {
      if (!remaining) return [];
      const excerpt = lyrics.slice(0, Math.min(8000, remaining));
      remaining -= excerpt.length;
      return [excerpt];
    });
  }

  async executeGeneration(song, signal) {
    const job = song.job;
    job.startedAt = new Date().toISOString();
    job.phase = 'preparing';
    const folder = path.join(getSongDirectory(this.store.root, song.id), 'work', job.id);
    await mkdir(folder, { recursive: true });
    const update = async (phase) => {
      signal.throwIfAborted();
      if (phase === 'draft' || phase === 'ready') {
        song.status = phase;
        job.outcome = 'complete';
        job.finishedAt = new Date().toISOString();
        delete job.phase;
      } else {
        song.status = job.kind;
        job.phase = phase;
      }
      song.updatedAt = new Date().toISOString();
      await this.store.save();
    };
    const onStart = (child) => {
      this.activeProcess = child;
      if (signal.aborted) child.kill();
    };
    const referenceABC = song.referenceABC || '';
    if (job.kind === 'audio') {
      const responseSchema = createSongCompletionSchema({
        ...song,
        ...job.input,
      });
      if (responseSchema.required.length) {
        await update('preparing');
        const referenceGuide = referenceABC ? createReferenceLyricsGuide(referenceABC) : null;
        const metadata = await this.writeMetadata({
          codex: this.codex,
          model: 'gpt-6.1-terra',
          reasoningEffort: 'medium',
          folder,
          schema: await saveResponseSchema(folder, responseSchema),
          prompt: createSongCompletionPrompt(
            { ...song, ...job.input },
            referenceGuide,
            responseSchema.required.includes('lyrics') ? this.getLyricsToAvoid(song) : [],
          ),
          timeoutMs: 5 * 60 * 1000,
          timeoutMessage: 'Preparing the song details took too long. Try again.',
          onStart,
          isCancelled: () => signal.aborted,
        });
        signal.throwIfAborted();
        this.applyCompletedDetails(song, responseSchema, metadata);
        Object.assign(job.input, getSongGenerationInput(song));
        if (song.coverFile === 'cover.svg') {
          await writeFile(
            getSongFilePath(this.store.root, song, song.coverFile),
            createCoverArtwork({
              id: song.id,
              title: song.title,
              subtitle: song.genres[0],
              seed: song.id,
              paletteId: song.coverPalette,
            }),
          );
          song.coverVersion = randomUUID();
        }
        await this.store.save();
      }
      const previousFiles = [song.audioFile, song.masterFile];
      await this.renderer.executeGeneration(song, job, {
        folder,
        signal,
        update,
        onStart,
        save: () => this.store.save(),
      });
      await cleanupUnusedSongAudio(this.store, song, previousFiles).catch(() => {});
      return;
    }
    const responseSchema = createSongCompletionSchema({
      ...song,
      ...job.input,
    });
    if (!responseSchema.required.length) {
      await update(getIdleSongStatus(song));
      return;
    }
    const referenceGuide = referenceABC ? createReferenceLyricsGuide(referenceABC) : null;
    const prompt = createSongCompletionPrompt(
      { ...song, ...job.input },
      referenceGuide,
      responseSchema.required.includes('lyrics') ? this.getLyricsToAvoid(song) : [],
    );
    if (referenceGuide)
      await writeFile(
        path.join(folder, 'reference-guide.json'),
        JSON.stringify(referenceGuide, null, 2),
      );
    await update('writing');
    const result = await this.writeLyrics({
      codex: this.codex,
      model: 'gpt-6.1-terra',
      reasoningEffort: 'medium',
      folder,
      schema: await saveResponseSchema(folder, responseSchema),
      prompt,
      timeoutMs: 5 * 60 * 1000,
      timeoutMessage: 'Writing took too long. Try another take.',
      onStart,
      isCancelled: () => signal.aborted,
    });
    signal.throwIfAborted();
    if (referenceGuide) song.referenceLyricsGuide = referenceGuide;
    else delete song.referenceLyricsGuide;
    delete song.referenceLyricPlan;
    this.applyCompletedDetails(song, responseSchema, result);
    if (song.coverFile === 'cover.svg') {
      await writeFile(
        getSongFilePath(this.store.root, song, song.coverFile),
        createCoverArtwork({
          id: song.id,
          title: song.title,
          subtitle: song.genres[0],
          seed: song.id,
          paletteId: song.coverPalette,
        }),
      );
      song.coverVersion = randomUUID();
    }
    job.finishedAt = new Date().toISOString();
    await update(getIdleSongStatus(song));
  }
}
