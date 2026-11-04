import { randomBytes } from 'node:crypto';
import { createReferenceMelody } from './reference-melody.mjs';

function copyLocalWorkflow(template, objectInfo) {
  const graph = structuredClone(template);
  for (const node of Object.values(graph)) {
    const info = objectInfo[node.class_type];
    if (!info) throw new Error(`ComfyUI is missing the ${node.class_type} node.`);
    if (info.api_node) throw new Error('The workflow must use local, credit-free nodes.');
  }
  return graph;
}

export function prepareSongWorkflow(
  template,
  objectInfo,
  input,
  { prefix, referenceABC = '', seed = randomBytes(6).readUIntBE(0, 6) },
) {
  const graph = copyLocalWorkflow(template, objectInfo);
  let music;
  let output;
  for (const node of Object.values(graph)) {
    if (['YuE2GenerateABC', 'YuE2GenerateMusic'].includes(node.class_type)) {
      Object.assign(node.inputs, { style: input.style, lyrics: input.lyrics, seed });
    }
    if (node.class_type === 'YuE2GenerateMusic') music = node;
    if (node.class_type === 'KSampler') node.inputs.seed = seed;
    if (node.class_type === 'SaveAudioAdvanced') {
      node.inputs.filename_prefix = prefix;
      output = node;
    }
  }
  if (!music || !output)
    throw new Error('The workflow is missing its song generator or audio output.');
  if (referenceABC) {
    music.inputs.abc = createReferenceMelody(referenceABC);
    music.inputs.mode = 'melody';
  }
  if (!music.inputs.abc) throw new Error('The song workflow needs an ABC score.');
  return graph;
}

export function prepareReferenceWorkflow(template, objectInfo, { sampleName, prefix }) {
  const graph = copyLocalWorkflow(template, objectInfo);
  const audio = Object.values(graph).find((node) => node.class_type === 'LoadAudio');
  const output = Object.values(graph).find((node) => node.class_type === 'SaveText');
  if (
    !audio ||
    !output ||
    !Object.values(graph).some((node) => node.class_type === 'SheetSage2AudioToABC')
  )
    throw new Error('The reference workflow needs Load Audio, SheetSage2, and Save Text.');
  audio.inputs.audio = sampleName;
  output.inputs.filename_prefix = prefix;
  return graph;
}
