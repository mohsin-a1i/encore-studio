export const comfyPromptIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function workflowOwnsOutput(graph, prefix) {
  return Object.values(graph || {}).some((node) => node?.inputs?.filename_prefix === prefix);
}
