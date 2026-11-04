import { readFile } from 'node:fs/promises';

export const referenceAbc = await readFile(
  new URL('../fixtures/reference-score.abc', import.meta.url),
  'utf8',
);

export const workflowFile = (name = 'yue2-song-from-style-and-lyrics') =>
  new URL(`../../generation/workflows/${name}.json`, import.meta.url);

export const objectInfo = JSON.parse(
  await readFile(new URL('../fixtures/comfy-nodes.json', import.meta.url), 'utf8'),
);

export async function savedWorkflow(name) {
  return JSON.parse(await readFile(workflowFile(name), 'utf8'));
}
