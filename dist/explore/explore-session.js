export const exploreDeckSize = 3;
export function createExploreView(saved = {}) {
  return {
    revision: 0,
    sessionId: null,
    idea: '',
    songId: null,
    queueIds: [],
    pending: 0,
    error: '',
    busy: false,
    ...saved,
  };
}
export function getExploreCandidates(state) {
  if (state.exploreStarting?.profileId === state.profileId) return [];
  const songs = new Map(state.exploreSongs.map((song) => [song.id, song]));
  const hidden = new Set(
    (state.exploreDecisions || [])
      .filter(
        (item) => item.profileId === state.profileId && item.sessionId === state.explore.sessionId,
      )
      .map((item) => item.songId),
  );
  return (state.explore.queueIds || [])
    .map((id) => songs.get(id))
    .filter((song) => song && !song.exploreDiscarded && !hidden.has(song.id));
}
export function getExploreSong(state) {
  const ready = getReadyExploreSongs(state);
  return ready.find((song) => song.id === state.explore.songId) || ready[0] || null;
}
export function getReadyExploreSongs(state) {
  return getExploreCandidates(state).filter((song) => song.audio && !song.error);
}
