import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const disabledPlugins = [
  'unified-computer-use',
  'codex-app-tools',
  'browser',
  'computer-use',
  'code-review',
];

function createCodexArguments({ folder, schema, resultFile, model, reasoningEffort }) {
  const config = [
    'approval_policy="never"',
    'mcp_servers.node_repl.enabled=false',
    ...(reasoningEffort ? [`model_reasoning_effort=${JSON.stringify(reasoningEffort)}`] : []),
    ...disabledPlugins.map((name) => `plugins."${name}@openai-bundled".enabled=false`),
    'mcp_servers.comfyui.enabled=false',
  ];
  return [
    'exec',
    ...(model ? ['--model', model] : []),
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '-C',
    folder,
    '--output-schema',
    fileURLToPath(schema),
    '-o',
    resultFile,
    ...config.flatMap((value) => ['-c', value]),
    '-',
  ];
}

// Codex only writes song text. Audio generation uses the ComfyUI HTTP API.
export function writeLyricsWithCodex({
  codex = 'codex',
  folder,
  schema,
  prompt,
  model,
  reasoningEffort,
  timeoutMs,
  timeoutMessage,
  onStart = () => {},
  isCancelled = () => false,
  spawnProcess = spawn,
}) {
  const resultFile = path.join(folder, 'result.json');
  return new Promise((resolve, reject) => {
    const child = spawnProcess(
      codex,
      createCodexArguments({ folder, schema, resultFile, model, reasoningEffort }),
      {
        shell: false,
        windowsHide: true,
        cwd: folder,
        env: { ...process.env },
      },
    );
    let stderr = '';
    let settled = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      finish(new Error(timeoutMessage));
      child.kill();
    }, timeoutMs);

    child.on('error', (error) =>
      finish(
        new Error(
          error.code === 'ENOENT'
            ? 'Codex CLI was not found. Install it or set CODEX_BIN before starting the studio.'
            : error.message,
        ),
      ),
    );
    child.stdin.on('error', (error) => finish(error));
    child.stdout.resume();
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-6000);
    });
    child.on('close', async (code) => {
      await writeFile(path.join(folder, 'codex-diagnostic.log'), stderr).catch(() => {});
      if (settled) return;
      if (isCancelled()) return finish(new Error('Cancelled'));
      if (code !== 0) {
        const detail = stderr.includes('not logged')
          ? 'Run codex login, then try again.'
          : 'See the local Codex diagnostic log for details.';
        return finish(new Error(`Codex could not complete this task (exit ${code}). ${detail}`));
      }
      try {
        finish(null, JSON.parse(await readFile(resultFile, 'utf8')));
      } catch (error) {
        finish(error);
      }
    });

    onStart(child);
    child.stdin.end(prompt);
  });
}
