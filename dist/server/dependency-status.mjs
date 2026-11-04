import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export function createDependencyStatus(
  { workflow, coverWorkflow, ytDlp, codex, comfy, queue },
  { request = fetch, execute = exec, exists = access, now = Date.now } = {},
) {
  const values = {};
  const checkedAt = {};
  const pending = new Map();
  const checks = {
    comfy: async () =>
      (await request(comfy + '/system_stats', { signal: AbortSignal.timeout(2500) })).ok,
    codex: async () => {
      await execute(codex, ['login', 'status'], { windowsHide: true, timeout: 10000 });
      return true;
    },
    workflow: async () => {
      await exists(workflow);
      return true;
    },
    coverWorkflow: async () => {
      await exists(coverWorkflow);
      return true;
    },
    ytDlp: async () => {
      await exists(ytDlp);
      return true;
    },
  };
  const snapshot = () => ({
    connected: true,
    ...values,
    workflowName: 'yue2-song-from-style-and-lyrics',
    active: queue.activeSongId,
  });
  async function check(name, force) {
    if (pending.has(name)) return pending.get(name);
    if (!force && name in checkedAt && now() - checkedAt[name] < 20000) return;
    const task = Promise.resolve()
      .then(checks[name])
      .then(
        (value) => {
          values[name] = value === true;
        },
        () => {
          values[name] = false;
        },
      )
      .finally(() => {
        checkedAt[name] = now();
        pending.delete(name);
      });
    pending.set(name, task);
    return task;
  }
  async function health(service) {
    if (service) {
      if (!['codex', 'comfy'].includes(service)) throw new Error('Unknown connection service.');
      await check(service, true);
    } else await Promise.all(Object.keys(checks).map((name) => check(name, false)));
    return snapshot();
  }
  health.snapshot = snapshot;
  return health;
}
