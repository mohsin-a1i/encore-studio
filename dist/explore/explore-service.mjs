import { randomUUID } from 'node:crypto';
import { RequestError, requireSafeId } from '../server/request-security.mjs';
import { requireProfile, ownerProfileId } from '../profiles/profile-records.mjs';
import { workspace, emptyExplore } from '../profiles/profile-workspace.mjs';
import { exploreSnapshot, exploreBufferSize } from './explore-state.mjs';

/** One coordinator owns generation and decisions, regardless of open browser tabs. */
export class ExploreService {
  #operations = Promise.resolve();
  constructor({ store, songs, health }) {
    Object.assign(this, { store, songs, health });
    this.unsubscribe = store.subscribe(() => this.schedule());
    this.scheduled = false;
    this.closed = false;
  }
  exclusive(action) {
    const result = this.#operations.catch(() => {}).then(action);
    this.#operations = result;
    return result;
  }
  change(profileId, action) {
    return this.exclusive(async () => {
      const profile = requireProfile(this.store, profileId);
      const before = structuredClone(workspace(profile).explore);
      try {
        return await action();
      } catch (error) {
        workspace(profile).explore = before;
        throw error;
      }
    });
  }
  state(profileId) {
    return workspace(requireProfile(this.store, profileId)).explore;
  }
  snapshot(profileId) {
    return exploreSnapshot(requireProfile(this.store, profileId), this.store.state.songs);
  }
  async persist(state) {
    state.revision++;
    await this.store.save();
  }
  start(profileId, input) {
    return this.change(profileId, async () => {
      const prior = this.state(profileId);
      requireSafeId(input.commandId);
      if (prior.startCommand === input.commandId) return this.snapshot(profileId);
      if (input.revision !== prior.revision)
        throw new RequestError(409, 'Explore changed on another device. Review the current idea.');
      if (typeof input.idea !== 'string' || !input.idea.trim() || input.idea.length > 4000)
        throw new RequestError(400, 'Enter an idea to explore.');
      const sameIdea = prior.sessionId && prior.idea === input.idea.trim();
      if (sameIdea && !this.snapshot(profileId).error) return this.snapshot(profileId);
      const available = await this.health();
      if (!available.codex || !available.comfy || !available.workflow)
        throw new RequestError(503, 'Connect Codex and ComfyUI to explore songs.');
      if (sameIdea) {
        this.resetFailedCandidates(prior);
        prior.startCommand = input.commandId;
        await this.persist(prior);
        this.schedule();
        return this.snapshot(profileId);
      }
      const state = {
        ...emptyExplore(),
        revision: prior.revision,
        idea: input.idea.trim(),
        sessionId: randomUUID(),
        startCommand: input.commandId,
        reservations: [randomUUID()],
        retiredIds: [
          ...new Set([
            ...prior.retiredIds,
            ...prior.queueIds,
            ...this.store.state.songs
              .filter((song) => song.temporary && ownerProfileId(song) === profileId)
              .map((song) => song.id),
          ]),
        ],
      };
      workspace(requireProfile(this.store, profileId)).explore = state;
      await this.persist(state);
      this.schedule();
      return this.snapshot(profileId);
    });
  }
  decide(profileId, input) {
    return this.change(profileId, async () => {
      const state = this.state(profileId);
      if (input.sessionId !== state.sessionId)
        throw new RequestError(409, 'This Explore session has changed.');
      requireSafeId(input.songId);
      if (!['keep', 'skip'].includes(input.decision))
        throw new RequestError(400, 'Invalid Explore decision.');
      const prior = state.decisions[input.songId];
      if (prior) {
        if (prior !== input.decision)
          throw new RequestError(409, 'This song has already been handled.');
        return this.snapshot(profileId);
      }
      const existing = this.store.state.songs.find(
        (song) => song.id === input.songId && ownerProfileId(song) === profileId,
      );
      if (input.decision === 'keep' && existing?.exploreDecision?.sessionId === state.sessionId)
        return this.snapshot(profileId);
      if (this.snapshot(profileId).songId !== input.songId)
        throw new RequestError(409, 'The current Explore card has changed.');
      const song = this.songs.get(input.songId);
      if (ownerProfileId(song) !== profileId || !song.temporary || !song.audioFile)
        throw new RequestError(409, 'This song is unavailable.');
      const apply = () => {
        state.decisions[song.id] = input.decision;
        state.queueIds = state.queueIds.filter((id) => id !== song.id);
        state.songId = null;
        state.error = '';
        state.revision++;
      };
      if (input.decision === 'keep') {
        const previous = {
          temporary: song.temporary,
          exploreSession: song.exploreSession,
          exploreDecision: song.exploreDecision,
          updatedAt: song.updatedAt,
        };
        try {
          await this.songs.saveExploration(song.id, apply);
        } catch (error) {
          Object.assign(song, previous);
          throw error;
        }
      } else {
        apply();
        state.retiredIds.push(song.id);
        await this.store.save();
      }
      this.schedule();
      return this.snapshot(profileId);
    });
  }
  retry(profileId, input) {
    return this.change(profileId, async () => {
      const state = this.state(profileId);
      if (input.sessionId !== state.sessionId || input.revision !== state.revision)
        throw new RequestError(409, 'Explore changed. Review the current deck.');
      this.resetFailedCandidates(state);
      await this.persist(state);
      this.schedule();
      return this.snapshot(profileId);
    });
  }
  resetFailedCandidates(state) {
    const failed = new Set(
      this.store.state.songs
        .filter((song) => state.queueIds.includes(song.id) && song.error)
        .map((song) => song.id),
    );
    state.queueIds = state.queueIds.filter((id) => !failed.has(id));
    state.retiredIds = [...new Set([...state.retiredIds, ...failed])];
    state.error = '';
    if (state.queueIds.length < exploreBufferSize && !state.reservations.length)
      state.reservations.push(randomUUID());
  }
  schedule() {
    if (this.closed || this.scheduled) return;
    this.scheduled = true;
    this.timer = setTimeout(() => {
      this.scheduled = false;
      void this.exclusive(() => this.fill()).catch((error) =>
        console.error('Explore could not save its state:', error.message),
      );
    }, 25);
    this.timer.unref?.();
  }
  async fill() {
    for (const profile of [...this.store.state.profiles]) {
      const state = this.state(profile.id);
      // Retired candidates stay available to active playback leases until released.
      for (const id of [...state.retiredIds]) {
        if (this.songs.mediaUse?.isPlaying(id)) continue;
        const song = this.store.state.songs.find((song) => song.id === id);
        if (song?.temporary) await this.songs.discardExploration(id);
        state.retiredIds = state.retiredIds.filter((item) => item !== id);
        await this.persist(state);
      }
      const present = this.snapshot(profile.id);
      if (
        JSON.stringify(state.queueIds) !== JSON.stringify(present.queueIds) ||
        state.songId !== present.songId
      ) {
        state.queueIds = present.queueIds;
        state.songId = present.songId;
        await this.persist(state);
      }
      if (!state.sessionId || present.error) continue;
      // Resolve durable reservations first; create() deduplicates by profile/request ID.
      while (state.reservations.length || state.queueIds.length < exploreBufferSize) {
        let reservation = state.reservations[0];
        if (!reservation) {
          reservation = randomUUID();
          state.reservations.push(reservation);
          await this.persist(state);
        }
        try {
          // Reaffirm even a recovered reservation before an external side effect.
          await this.store.save();
          const song = await this.songs.create(
            state.idea,
            reservation,
            '',
            { kind: 'explore', exploreSession: state.sessionId },
            profile.id,
          );
          if (!state.queueIds.includes(song.id)) state.queueIds.push(song.id);
          state.reservations = state.reservations.filter((id) => id !== reservation);
          await this.persist(state);
        } catch (error) {
          state.error =
            'Explore could not prepare another song. Retry when the service is available.';
          await this.persist(state);
          break;
        }
      }
    }
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.unsubscribe();
  }
}
