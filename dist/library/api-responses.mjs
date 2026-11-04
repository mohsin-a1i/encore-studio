import path from 'node:path';
import { ownerProfileId } from '../profiles/profile-records.mjs';
import { hasLoadedReference } from '../songs/song-record.mjs';

export function serializeSong(song) {
  const {
    audioFile,
    masterFile,
    coverFile,
    sampleFile,
    sampleSourceUrl,
    referenceABCSource: _referenceABCSource,
    referenceABC: _referenceABC,
    referenceLyricPlan: _referenceLyricPlan,
    referenceLyricsGuide: _referenceLyricsGuide,
    referencePreparation,
    job,
    renderIds: _renderIds,
    requests: _requests,
    pendingAudioFiles: _pendingAudioFiles,
    lyricsIdea: _lyricsIdea,
    previousLyrics: _previousLyrics,
    ...safe
  } = song;
  return {
    ...safe,
    referencePrepared: Boolean(
      (song.sampleUrl || song.sampleKind === 'upload') && hasLoadedReference(song),
    ),
    referencePreparation: referencePreparation
      ? Object.fromEntries(
          ['phase', 'outcome', 'error'].map((key) => [key, referencePreparation[key]]),
        )
      : null,
    job: job
      ? {
          ...Object.fromEntries(
            [
              'id',
              'kind',
              'phase',
              'outcome',
              'queuedAt',
              'startedAt',
              'finishedAt',
              'promptId',
              'workflowName',
              'referencePromptId',
              'referenceWorkflowName',
            ].map((key) => [key, job[key]]),
          ),
        }
      : null,
    audio: audioFile
      ? `api/audio/${song.id}?v=${encodeURIComponent(audioFile)}&profile=${encodeURIComponent(ownerProfileId(song))}`
      : null,
    sampleAudio:
      sampleFile && sampleSourceUrl === song.sampleUrl
        ? `api/sample/${song.id}?v=${encodeURIComponent(sampleFile)}&profile=${encodeURIComponent(ownerProfileId(song))}`
        : null,
    cover: coverFile
      ? `api/cover/song/${song.id}?v=${encodeURIComponent(song.coverVersion || coverFile)}&profile=${encodeURIComponent(ownerProfileId(song))}`
      : null,
  };
}
export function serializePlaylist(playlist) {
  const { coverFile, ...safe } = playlist;
  return {
    ...safe,
    cover: coverFile
      ? `api/cover/playlist/${playlist.id}?v=${encodeURIComponent(playlist.coverVersion || path.basename(coverFile))}&profile=${encodeURIComponent(ownerProfileId(playlist))}`
      : null,
  };
}
