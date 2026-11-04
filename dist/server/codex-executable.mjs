import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Desktop shortcuts and background services can inherit different PATH values.
export function resolveCodexExecutable(environment = process.env, platform = process.platform) {
  if (environment.CODEX_BIN) return environment.CODEX_BIN;
  if (platform !== 'win32') return 'codex';

  const searchPath = environment.PATH || environment.Path || '';
  for (const directory of searchPath.split(';').filter(Boolean)) {
    const executable = path.join(directory.replace(/^"|"$/g, ''), 'codex.exe');
    if (existsSync(executable)) return executable;
  }

  if (environment.LOCALAPPDATA) {
    const installRoot = path.join(environment.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    try {
      const installations = readdirSync(installRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(installRoot, entry.name, 'codex.exe'))
        .filter((executable) => existsSync(executable))
        .sort((first, second) => statSync(second).mtimeMs - statSync(first).mtimeMs);
      if (installations.length) return installations[0];
    } catch {
      // Let the normal command lookup report a missing CLI when no installation is available.
    }
  }

  return 'codex';
}
