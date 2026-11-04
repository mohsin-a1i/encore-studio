import { writeDevice } from './device-state.js';
import { applyProfilePreferences } from '../profiles/profile-preferences.js';
import { studioState, studioOrigin, reconcileSongEdits, songEdits } from './browser-state.js';
import { showToast } from './interface-helpers.js';
import { selectProfileWorkspace } from '../profiles/profile-state.js';

export function createStudioConnection({ syncPlaybackWithLibrary }) {
  const lastReady = new Set();
  let hasLibrary = false;

  let stream,
    streamProfile,
    onUpdate,
    eventVersion = 0;
  const revisions = new Map();
  const acknowledged = new Map();
  let failureCheck = null;
  let observedExploreFailure = null;
  const healthVersions = { codex: 0, comfy: 0 };

  function recheckAfterFailure(services = []) {
    if (failureCheck) {
      for (const service of services) failureCheck.services.add(service);
      return failureCheck.promise;
    }
    const check = { services: new Set(services) };
    failureCheck = check;
    check.promise = (async () => {
      try {
        await requestStudio('health/studio');
        studioState.connected = true;
        // Explicit dependency endpoints bypass the normal health cache.
        while (check.services.size) {
          const batch = [...check.services];
          check.services.clear();
          await Promise.all(batch.map((service) => refreshDependencyStatus(service)));
        }
      } catch {
        studioState.connected = false;
        studioState.health = {};
      } finally {
        failureCheck = null;
        onUpdate?.();
      }
    })();
    return check.promise;
  }
  function applyLibrary(data) {
    const id = data.profile?.id;
    if (
      id &&
      data.revision !== undefined &&
      data.revision < Math.max(revisions.get(id) ?? -1, acknowledged.get(id) ?? -1)
    )
      return;
    if (id && data.revision !== undefined) revisions.set(id, data.revision);
    if (
      id === studioState.profileId &&
      data.explore?.revision < (studioState.explore?.revision || 0)
    )
      data.explore = studioState.explore;
    if (
      id === studioState.profileId &&
      data.preferenceRevision < (studioState.preferenceRevision || 0)
    ) {
      data.preferenceRevision = studioState.preferenceRevision;
      data.profilePreferences = studioState.profilePreferences;
    }
    if (data.deletedSongIds?.includes(studioState.selectedSongId)) {
      if (songEdits.has(studioState.selectedSongId))
        studioState.deletedEditorId = studioState.selectedSongId;
      studioState.selectedSongId = null;
      Object.assign(studioState, {
        draftTitle: '',
        draftStyle: '',
        draftLyrics: '',
        sampleUrl: '',
        sampleUpload: null,
        draftRequestId: null,
      });
      writeDevice('song-id', null, studioState.profileId);
    }
    Object.assign(studioState, data);
    const failure = data.explore?.error
      ? JSON.stringify([
          studioState.profileId,
          data.explore.sessionId,
          data.explore.error,
          data.exploreSongs
            ?.filter((song) => song.error)
            .map((song) => [song.id, song.job?.id, song.error]),
        ])
      : null;
    if (failure && failure !== observedExploreFailure) {
      const failed = data.exploreSongs?.filter((song) => song.error) || [];
      const services = failed.map((song) =>
        song.job?.kind === 'audio' ? 'comfy' : song.job?.kind === 'lyrics' ? 'codex' : null,
      );
      void recheckAfterFailure(
        services.length && services.every(Boolean) ? [...new Set(services)] : ['codex', 'comfy'],
      );
    }
    observedExploreFailure = failure;
    applyProfilePreferences(data.profilePreferences);
    studioState.connected = true;
    studioState.songs.forEach(reconcileSongEdits);
    syncPlaybackWithLibrary();
    for (const song of studioState.songs) {
      const version = song.id + ':' + (song.audioVersion || 'original');
      if (song.audio && !lastReady.has(version)) {
        lastReady.add(version);
        if (hasLibrary) showToast(`${song.title} is ready to play.`);
      }
    }
    hasLibrary = true;
  }
  function watchProfile() {
    if (!onUpdate || !globalThis.EventSource || streamProfile === studioState.profileId) return;
    stream?.close();
    const profileId = studioState.profileId;
    streamProfile = profileId;
    stream = new EventSource(`${studioOrigin}/api/events?profile=${encodeURIComponent(profileId)}`);
    const source = stream;
    stream.addEventListener('message', (event) => {
      if (stream !== source || profileId !== studioState.profileId) return;
      const data = JSON.parse(event.data);
      if (!data.profile) {
        if (data.profiles?.length) {
          studioState.profiles = data.profiles;
          selectProfileWorkspace(data.profiles[0].id);
          void refreshLibrary().then(() => onUpdate?.());
        }
        return;
      }
      eventVersion++;
      applyLibrary(data);
      onUpdate();
    });
    stream.addEventListener('open', () => {
      if (stream === source && profileId === studioState.profileId) {
        studioState.connected = true;
        void refreshDependencyStatus();
      }
    });
    stream.addEventListener('error', () => {
      if (stream !== source || profileId !== studioState.profileId) return;
      studioState.connected = false;
      onUpdate();
    });
  }
  function startUpdates(listener) {
    onUpdate = listener;
    watchProfile();
    return () => {
      stream?.close();
      stream = null;
      streamProfile = null;
      onUpdate = null;
    };
  }

  async function requestStudio(route, options = {}) {
    try {
      const profileId = options.headers?.['X-Profile-Id'] || studioState.profileId;
      const res = await fetch(studioOrigin + '/api/' + route, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'X-Profile-Id': studioState.profileId,
          ...options.headers,
        },
        signal: AbortSignal.timeout(
          options.body?.includes?.('"sampleUpload"') ||
            (route.startsWith('profiles/') && options.method === 'DELETE')
            ? 180000
            : 20000,
        ),
      });
      const revision = Number(res.headers?.get?.('X-State-Revision'));
      if (res.ok && options.method && options.method !== 'GET' && Number.isSafeInteger(revision))
        acknowledged.set(profileId, Math.max(acknowledged.get(profileId) ?? -1, revision));
      const data = await res.json();
      if (!res.ok)
        throw Object.assign(
          new Error(data.error || 'The studio could not complete this request.'),
          {
            status: res.status,
          },
        );
      return data;
    } catch (error) {
      if (!route.startsWith('health'))
        void recheckAfterFailure(route.startsWith('explore/') ? ['codex', 'comfy'] : []);
      throw error;
    }
  }
  async function connectStudio() {
    return refreshLibrary();
  }
  async function refreshLibrary() {
    const profileId = studioState.profileId;
    const version = eventVersion;
    try {
      const data = await requestStudio('library');
      if (profileId !== studioState.profileId) return false;
      if (version !== eventVersion) return true;
      applyLibrary(data);
      watchProfile();
      return true;
    } catch (error) {
      if (profileId !== studioState.profileId) return false;
      if (version !== eventVersion) return true;
      if (error.status === 404) {
        try {
          const { profiles } = await requestStudio('profiles');
          if (profileId !== studioState.profileId) return false;
          if (profiles.length && !profiles.some((profile) => profile.id === profileId)) {
            studioState.profiles = profiles;
            selectProfileWorkspace(profiles[0].id);
            return refreshLibrary();
          }
        } catch {
          /* The connection status below handles an unavailable service. */
        }
      }
      studioState.connected = false;
      studioState.health = {};
      return false;
    }
  }

  async function refreshDependencyStatus(service) {
    if (!studioState.connected) return false;
    const services = service ? [service] : ['codex', 'comfy'];
    const versions = Object.fromEntries(services.map((id) => [id, ++healthVersions[id]]));
    try {
      const data = await requestStudio(service ? 'health/' + service : 'health');
      for (const id of services) {
        if (versions[id] === healthVersions[id]) studioState.health[id] = data[id] === true;
      }
      // Dependency endpoints include cached results for other services; ignore them.
      for (const key of ['workflow', 'coverWorkflow', 'ytDlp', 'workflowName']) {
        if (data[key] !== undefined) studioState.health[key] = data[key];
      }
      return service ? data[service] === true : true;
    } catch {
      // The dependency check cannot establish whether the Studio itself is down.
      // The next library request verifies that connection independently.
      for (const id of services) {
        if (versions[id] === healthVersions[id]) studioState.health[id] = false;
      }
      return false;
    } finally {
      onUpdate?.();
    }
  }

  async function retryServiceConnection(service) {
    if (service === 'studio') return connectStudio();
    if (!['codex', 'comfy'].includes(service)) throw new Error('Unknown connection service.');
    if (!studioState.connected && !(await connectStudio())) return false;
    return refreshDependencyStatus(service);
  }

  return {
    requestStudio,
    startUpdates,
    connectStudio,
    refreshLibrary,
    refreshDependencyStatus,
    retryServiceConnection,
  };
}
