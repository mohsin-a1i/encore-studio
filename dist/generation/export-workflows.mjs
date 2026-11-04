import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Export only Encore's own API graphs into readable ComfyUI editor layouts.
const root = fileURLToPath(new URL('../../', import.meta.url));
const target = path.resolve(
  process.argv[2] || 'C:/Projects/ComfyUI/ComfyUI/user/default/workflows/encore',
);
const info = await fetch('http://127.0.0.1:8188/object_info').then((response) => response.json());
await mkdir(target, { recursive: true });
for (const name of [
  'yue2-song-from-style-and-lyrics',
  'yue2-song-from-reference-abc',
  'sheetsage2-reference-audio-to-abc',
]) {
  const graph = JSON.parse(
    await readFile(path.join(root, 'dist/generation/workflows', name + '.json'), 'utf8'),
  );
  const edges = [];
  const depths = new Map();
  const rows = new Map();
  function depth(id) {
    if (depths.has(id)) return depths.get(id);
    const dependencies = Object.values(graph[id].inputs)
      .filter(Array.isArray)
      .map((value) => String(value[0]));
    const result = dependencies.length ? 1 + Math.max(...dependencies.map(depth)) : 0;
    depths.set(id, result);
    return result;
  }
  const nodes = Object.entries(graph).map(([id, node], order) => {
    const definition = info[node.class_type];
    if (!definition) throw new Error('Missing ComfyUI node: ' + node.class_type);
    const widgets = [];
    const inputs = [];
    const schema = { ...definition.input.required, ...definition.input.optional };
    for (const [key, value] of Object.entries(node.inputs)) {
      const [type, options] = schema[key] || [];
      if (Array.isArray(value)) {
        const link = edges.length + 1;
        edges.push([link, Number(value[0]), value[1], Number(id), inputs.length, type]);
        inputs.push({ name: key, type, link });
      } else {
        inputs.push({
          name: key,
          type: Array.isArray(type) ? 'COMBO' : type,
          widget: { name: key },
          link: null,
        });
        widgets.push(value);
        if (options?.control_after_generate || (node.class_type === 'KSampler' && key === 'seed'))
          widgets.push('randomize');
      }
    }
    const column = depth(id);
    const row = rows.get(column) || 0;
    rows.set(column, row + 1);
    return {
      id: Number(id),
      type: node.class_type,
      title: node._meta?.title,
      pos: [column * 390, row * 440],
      size: [330, Math.max(120, 70 + widgets.length * 28)],
      flags: {},
      order,
      mode: 0,
      inputs,
      outputs: (definition.output || []).map((type, index) => ({
        name: definition.output_name?.[index] || type,
        type,
        links: [],
      })),
      properties: { 'Node name for S&R': node.class_type },
      widgets_values: widgets,
    };
  });
  for (const edge of edges)
    nodes.find((node) => node.id === edge[1]).outputs[edge[2]].links.push(edge[0]);
  const workflow = {
    last_node_id: Math.max(...nodes.map((node) => node.id)),
    last_link_id: edges.length,
    nodes,
    links: edges,
    groups: [],
    config: {},
    extra: { ds: { scale: 0.65, offset: [40, 80] } },
    version: 0.4,
  };
  await writeFile(path.join(target, name + '.json'), JSON.stringify(workflow, null, 2) + '\n');
  console.log('Exported ' + name + ' to ' + target);
}
