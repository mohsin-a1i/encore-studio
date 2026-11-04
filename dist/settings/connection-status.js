import { studioState } from '../app/browser-state.js';

export const connectionServices = [
  { id: 'studio', name: 'Studio' },
  { id: 'codex', name: 'Codex' },
  { id: 'comfy', name: 'ComfyUI' },
];

export function isServiceConnected(id) {
  return studioState.connected && (id === 'studio' || studioState.health[id] === true);
}

export const allServicesConnected = () =>
  connectionServices.every(({ id }) => isServiceConnected(id));

export function getServiceStatus(id) {
  if (studioState.connectionChecks.has(id)) return 'Checking…';
  if (isServiceConnected(id)) return 'Connected';
  if (id !== 'studio' && (!studioState.connected || studioState.health[id] === undefined))
    return 'Not checked';
  return 'Not connected';
}

export const getConnectionSnapshotKey = () =>
  JSON.stringify([studioState.connected, studioState.health.codex, studioState.health.comfy]);
