import { ExploreService } from '../explore/explore-service.mjs';
import { PlaybackLeases, playbackRoutes } from '../playback/playback-leases.mjs';
import http from 'node:http';
import path from 'node:path';
import { config, projectRoot, storage } from './configuration.mjs';
import { createDependencyStatus } from './dependency-status.mjs';
import { sendJsonResponse, streamMediaFile } from './http-responses.mjs';
import { RequestError, isPublicAssetPath } from './request-security.mjs';
import { openLibraryStore } from '../library/library-store.mjs';
import { ComfySongRenderer } from '../generation/song-audio-renderer.mjs';
import { SongService } from '../songs/song-service.mjs';
import { libraryRoutes } from '../library/library-routes.mjs';
import { songRoutes } from '../songs/song-routes.mjs';
import { exploreRoutes } from '../explore/explore-routes.mjs';
import { studioEvents } from './studio-events.mjs';
import { mediaRoutes } from '../songs/media-routes.mjs';
import { profileRoutes } from '../profiles/profile-routes.mjs';
import { defaultProfileId, requireProfile } from '../profiles/profile-records.mjs';

process.chdir(projectRoot);
const store = await openLibraryStore(config.dataRoot);
const renderer = new ComfySongRenderer({
  root: config.dataRoot,
  ...config,
  ...storage,
});
const songs = new SongService({
  store,
  renderer,
  codex: config.codex,
  storage,
});
const health = createDependencyStatus({ ...config, queue: songs });
songs.mediaUse = new PlaybackLeases();
const explore = new ExploreService({ store, songs, health });
explore.schedule();
const exploreTimer = setInterval(() => explore.schedule(), 30000);
exploreTimer.unref();

async function finishCleanup() {
  await songs.cleanup();
}

await finishCleanup();
let cleanupBusy = false;
const cleanupTimer = setInterval(async () => {
  if (
    cleanupBusy ||
    (!store.state.pendingSongDeletions.length &&
      !store.state.songs.some((song) => song.pendingAudioFiles?.length))
  )
    return;
  cleanupBusy = true;
  try {
    await finishCleanup();
  } catch (error) {
    console.error('Studio file cleanup will retry:', error.message);
  } finally {
    cleanupBusy = false;
  }
}, 30_000);
cleanupTimer.unref();

function setRequestHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Private-Network', 'true');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id, X-Profile-Id');
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, DELETE, OPTIONS');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
}

const routes = {
  profiles: profileRoutes,
  playback: playbackRoutes,
  library: libraryRoutes,
  songs: songRoutes,
  explore: exploreRoutes,
  events: studioEvents,
  playlists: libraryRoutes,
  cover: mediaRoutes,
  audio: mediaRoutes,
  sample: mediaRoutes,
  download: mediaRoutes,
};

async function handleRequest(request, response) {
  try {
    setRequestHeaders(response);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      return response.end();
    }

    const url = new URL(request.url, `http://127.0.0.1:${config.port}`);
    const routeSegments = url.pathname.split('/').filter(Boolean);
    if (routeSegments[0] === 'api') {
      if (routeSegments[1] === 'health' && request.method === 'GET') {
        if (routeSegments.length === 2) return sendJsonResponse(response, 200, await health());
        if (routeSegments.length === 3 && routeSegments[2] === 'studio')
          return sendJsonResponse(response, 200, health.snapshot());
        if (routeSegments.length === 3 && ['codex', 'comfy'].includes(routeSegments[2]))
          return sendJsonResponse(response, 200, await health(routeSegments[2]));
        throw new RequestError(404, 'Endpoint not found.');
      }
      const route = Object.hasOwn(routes, routeSegments[1]) && routes[routeSegments[1]];
      if (!route) throw new RequestError(404, 'Endpoint not found.');
      const profileId =
        request.headers['x-profile-id'] || url.searchParams.get('profile') || defaultProfileId;
      if (routeSegments[1] !== 'profiles') requireProfile(store, profileId);
      response.getStateRevision = () => store.committedRevision;
      return await route({
        request,
        response,
        routeSegments,
        store,
        songs,
        explore,
        health,
        storage,
        dataRoot: config.dataRoot,
        profileId,
      });
    }

    if (!['GET', 'HEAD'].includes(request.method))
      throw new RequestError(405, 'Method not allowed.');
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(config.staticRoot, '.' + relative);
    if (!file.startsWith(config.staticRoot + path.sep) || relative.includes('\0')) {
      throw new RequestError(403, 'Invalid path.');
    }
    if (!isPublicAssetPath(path.relative(config.staticRoot, file)))
      throw new RequestError(403, 'This file is private to the studio service.');
    await streamMediaFile(request, response, file);
  } catch (error) {
    if (!response.headersSent)
      sendJsonResponse(response, error.status || 500, {
        error: error.message || 'Something went wrong.',
      });
    else response.destroy();
  }
}

const servers = [http.createServer(handleRequest)];
servers[0].listen(config.port, '127.0.0.1', () => {
  console.log(`Encore Studio is ready at http://127.0.0.1:${config.port}`);
});

for (const address of config.netbirdAddresses) {
  const netbirdServer = http.createServer(handleRequest);
  servers.push(netbirdServer);
  netbirdServer.listen(config.port, address, () => {
    console.log(`Encore Studio is ready on NetBird at http://${address}:${config.port}`);
  });
  netbirdServer.on('error', (error) => {
    console.error(`Encore Studio could not listen on NetBird ${address}:`, error.message);
  });
}

process.on('SIGINT', () => {
  for (const server of servers) server.close();
  process.exit(0);
});
