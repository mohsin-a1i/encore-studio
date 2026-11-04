import { spawn } from 'node:child_process';

const child = spawn(process.env.CODEX_BIN || 'codex', ['login', 'status'], {
  windowsHide: true,
  shell: false,
  stdio: 'inherit',
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('close', (code) => (process.exitCode = code ?? 1));
