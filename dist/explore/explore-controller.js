import { createRequestId } from '../app/request-id.js';
import { getExploreSong } from './explore-session.js';

/** Browser commands act on a server-owned deck; synchronization never generates songs. */
export function createExploreController({
  state,
  audio,
  requestStudio,
  startSong,
  render,
  refreshLibrary = async () => {},
  notify = () => {},
  onAutoSkip,
  createId = createRequestId,
}) {
  let pending = null;
  let advanceAfter = null;
  const decisions = [];
  let sending = false;
  let previewPlaybackId = null;
  function publishDecisions() {
    state.exploreDecisions = decisions.map(({ profileId, sessionId, songId }) => ({
      profileId,
      sessionId,
      songId,
    }));
  }
  async function command(action, input) {
    if (!state.connected) {
      return;
    }
    if (pending || decisions.length) return;
    const profileId = state.profileId;
    const operation = { profileId };
    pending = operation;
    state.explore.busy = true;
    render();
    try {
      const result = await requestStudio(`explore/${action}`, {
        method: 'POST',
        headers: { 'X-Profile-Id': profileId },
        body: JSON.stringify(input),
      });
      if (profileId !== state.profileId) return;
      if (result.revision >= (state.explore.revision || 0)) state.explore = result;
      await refreshLibrary();
      return result;
    } catch (error) {
      if (profileId === state.profileId) {
        if (error.status === 409) await refreshLibrary();
        if (error.status === 400 || error.status === 409) notify(error.message);
      }
    } finally {
      if (pending === operation) pending = null;
      if (profileId === state.profileId) {
        state.explore.busy = false;
        sync();
        render();
      }
    }
  }
  async function start(idea) {
    if (!state.connected || pending || !idea.trim()) return;
    const optimistic = { profileId: state.profileId, idea: idea.trim() };
    state.exploreStarting = optimistic;
    render();
    await Promise.all(decisions.map((item) => item.finished));
    if (state.profileId !== optimistic.profileId) {
      if (state.exploreStarting === optimistic) state.exploreStarting = null;
      return;
    }
    const result = await command('start', {
      idea,
      revision: state.explore.revision || 0,
      commandId: createId(),
    });
    if (state.exploreStarting === optimistic) state.exploreStarting = null;
    if (!result) {
      render();
      return;
    }
    state.exploreDraft = undefined;
    advanceAfter = { profileId: state.profileId, sessionId: result.sessionId };
    sync();
    render();
  }
  function releaseAudio() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    Object.assign(state, { currentId: null, currentAudio: null, playing: false });
  }
  function vote(direction) {
    const song = getExploreSong(state);
    // A background EventSource can disconnect while media/API requests still work.
    // Attempt the idempotent decision instead of blocking cached queue playback.
    if (pending || !song) return Promise.resolve();
    const operation = {
      profileId: state.profileId,
      sessionId: state.explore.sessionId,
      songId: song.id,
      direction,
      wasCurrent: state.currentId === song.id,
    };
    const finished = new Promise((resolve) => {
      operation.resolve = resolve;
    });
    operation.finished = finished;
    decisions.push(operation);
    publishDecisions();
    if (operation.wasCurrent) {
      if (!getExploreSong(state)) releaseAudio();
      advanceAfter = { profileId: operation.profileId, sessionId: operation.sessionId };
      sync();
    }
    render();
    void sendDecisions();
    return finished;
  }
  async function sendDecisions() {
    if (sending) return;
    sending = true;
    try {
      while (decisions.length) {
        const operation = decisions[0];
        const current = () =>
          operation.profileId === state.profileId &&
          operation.sessionId === state.explore.sessionId;
        try {
          const result = await requestStudio('explore/decision', {
            method: 'POST',
            headers: { 'X-Profile-Id': operation.profileId },
            body: JSON.stringify({
              songId: operation.songId,
              sessionId: operation.sessionId,
              decision: operation.direction === 'right' ? 'keep' : 'skip',
            }),
          });
          if (current() && result.revision >= (state.explore.revision || 0)) state.explore = result;
          decisions.shift();
          publishDecisions();
          if (current() && operation.direction === 'right') notify('Added to your library.');
          operation.resolve(result);
        } catch (error) {
          // A failed/ambiguous write must reconcile before another card is submitted.
          const cancelled = decisions.filter(
            (item) =>
              item.profileId === operation.profileId && item.sessionId === operation.sessionId,
          );
          const remaining = decisions.filter((item) => !cancelled.includes(item));
          decisions.splice(0, decisions.length, ...remaining);
          publishDecisions();
          if (operation.profileId === state.profileId) {
            await refreshLibrary().catch(() => {});
            if (
              current() &&
              cancelled.some((item) => item.wasCurrent) &&
              (!state.currentId || state.currentId === previewPlaybackId)
            ) {
              releaseAudio();
              advanceAfter = { profileId: operation.profileId, sessionId: operation.sessionId };
            }
            if ([400, 409].includes(error.status)) notify(error.message);
          }
          cancelled.forEach((item) => item.resolve());
        }
        sync();
        render();
      }
    } finally {
      sending = false;
      void refreshLibrary().catch(() => {});
    }
  }
  function sync() {
    if (pending?.profileId !== state.profileId) state.explore.busy = false;
    else state.explore.busy = true;
    if (!advanceAfter) return;
    if (
      advanceAfter.profileId !== state.profileId ||
      advanceAfter.sessionId !== state.explore.sessionId
    ) {
      advanceAfter = null;
      return;
    }
    const id = getExploreSong(state)?.id;
    if (!id || !state.exploreSongs.some((song) => song.id === id && song.audio)) return;
    advanceAfter = null;
    previewPlaybackId = id;
    void startSong(id, [id]).catch((error) => notify(error.message));
  }
  function advance() {
    if (state.currentId !== getExploreSong(state)?.id || !state.currentId) return false;
    if (!pending) {
      // This callback only presents the skip. Native playback never awaits animation.
      try {
        onAutoSkip?.(state.currentId);
      } finally {
        void vote('left');
      }
    }
    return true;
  }
  return {
    start,
    vote,
    sync,
    advance,
    retry: () =>
      command('retry', {
        sessionId: state.explore.sessionId,
        revision: state.explore.revision,
      }),
  };
}
