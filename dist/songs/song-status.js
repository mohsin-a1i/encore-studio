export const isSongGenerating = (song) => song.status === 'lyrics' || song.status === 'audio';

export const songStatuses = [
  { id: 'draft', label: 'Draft', icon: 'edit' },
  { id: 'lyrics', label: 'Auto completing', icon: 'edit' },
  { id: 'audio', label: 'Composing Song', icon: 'note' },
  { id: 'ready', label: 'Ready to play', icon: 'play' },
];

export const getIdleSongStatus = (song) => (song.audioFile || song.audio ? 'ready' : 'draft');

export function getSongStatusLabel(song) {
  return songStatuses.find((status) => status.id === song.status)?.label || 'Draft';
}

// Migrate older records. Internal work phases belong to the job, never the song status.
export function normalizeSongStatus(song) {
  const previous = song.status;
  if (['queued', 'downloading', 'preparing', 'rendering', 'saving'].includes(previous)) {
    song.status = song.job?.kind === 'lyrics' ? 'lyrics' : 'audio';
    if (song.job) song.job.phase = previous;
  } else if (!isSongGenerating(song)) {
    song.status = getIdleSongStatus(song);
    if (song.job) delete song.job.phase;
    if (song.job && ['failed', 'cancelled'].includes(previous)) song.job.outcome = previous;
    else if (
      song.job &&
      !song.job.outcome &&
      (song.job.finishedAt || previous === 'ready' || previous === 'review')
    )
      song.job.outcome = 'complete';
  }
}
