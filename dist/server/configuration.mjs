import path from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { getNetBirdAddresses } from './netbird-addresses.mjs';
import { resolveCodexExecutable } from './codex-executable.mjs';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const workflowPath =
  process.env.MUSIC_WORKFLOW ||
  path.join(projectRoot, 'dist/generation/workflows/yue2-song-from-style-and-lyrics.json');

export const config = {
  port: Number(process.env.PORT || 4318),
  netbirdAddresses: getNetBirdAddresses(networkInterfaces()),
  staticRoot: path.resolve(
    process.env.ENCORE_DIST_DIR || process.env.AFTERGLOW_DIST_DIR || path.join(projectRoot, 'dist'),
  ),
  dataRoot: path.resolve(
    process.env.ENCORE_DATA_DIR || process.env.AFTERGLOW_DATA_DIR || path.join(projectRoot, 'data'),
  ),
  codex: resolveCodexExecutable(),
  comfy: 'http://127.0.0.1:8188',
  workflow: workflowPath,
  coverWorkflow:
    process.env.MUSIC_COVER_WORKFLOW ||
    path.join(path.dirname(workflowPath), 'yue2-song-from-reference-abc.json'),
  referenceWorkflow:
    process.env.MUSIC_REFERENCE_WORKFLOW ||
    path.join(projectRoot, 'dist/generation/workflows/sheetsage2-reference-audio-to-abc.json'),
  ytDlp: process.env.YTDLP_BIN || path.join(projectRoot, '.sites-runtime/bin/yt-dlp.exe'),
};

export const storage = {
  dataRoot: config.dataRoot,
  comfyInputRoot: path.resolve(
    process.env.COMFY_INPUT_DIR || 'C:\\Projects\\ComfyUI\\ComfyUI\\input',
  ),
  comfyOutputRoot: path.resolve(
    process.env.COMFY_OUTPUT_DIR || 'C:\\Projects\\ComfyUI\\ComfyUI\\output\\audio',
  ),
};
