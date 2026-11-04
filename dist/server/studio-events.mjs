import { librarySnapshot } from '../library/library-snapshot.mjs';
import { RequestError } from './request-security.mjs';

export function studioEvents({ request, response, store, profileId }) {
  if (request.method !== 'GET') throw new RequestError(405, 'Method not allowed.');
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let lastSnapshot;
  let lastRevision = -1,
    blocked = false,
    queued;
  const send = (state, revision) => {
    if (revision <= lastRevision || response.destroyed) return;
    if (blocked) {
      queued = [state, revision];
      return;
    }
    lastRevision = revision;
    const data = librarySnapshot(state, profileId);
    const { revision: _revision, ...content } = data;
    const comparable = JSON.stringify(content);
    if (comparable === lastSnapshot || response.destroyed) return;
    lastSnapshot = comparable;
    const snapshot = JSON.stringify(data);
    blocked = !response.write(`data: ${snapshot}\n\n`);
  };
  const unsubscribe = store.subscribe(send);
  response.on('close', unsubscribe);
  response.on('drain', () => {
    blocked = false;
    if (queued) {
      const pending = queued;
      queued = null;
      send(...pending);
    }
  });
  send(store.state, store.revision);
}
