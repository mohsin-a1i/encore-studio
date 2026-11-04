import { workspace } from '../profiles/profile-workspace.mjs';

export const exploreBufferSize = 6;
export function exploreSnapshot(profile, songs) {
  const state = workspace(profile).explore;
  const byId = new Map(songs.map((song) => [song.id, song]));
  const ids = state.queueIds.filter(
    (id) => byId.get(id)?.temporary && byId.get(id)?.exploreSession === state.sessionId,
  );
  const ready = ids.filter((id) => byId.get(id)?.audioFile && !byId.get(id)?.error);
  const songId = ready.includes(state.songId) ? state.songId : ready[0] || null;
  return {
    revision: state.revision,
    sessionId: state.sessionId,
    idea: state.idea,
    songId,
    queueIds: ids,
    pending:
      state.reservations.length +
      ids.filter((id) => !byId.get(id)?.audioFile && !byId.get(id)?.error).length,
    error: state.error || ids.map((id) => byId.get(id)?.error).find(Boolean) || '',
    busy: false,
  };
}
