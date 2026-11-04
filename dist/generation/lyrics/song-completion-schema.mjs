import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const fields = {
  title: { type: 'string' },
  style: { type: 'string' },
  lyrics: { type: 'string' },
  genres: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
};

function needsGenreTags(song) {
  return !song.genres?.length || !song.style?.trim() || song.genreStyle !== song.style;
}

function responseSchema(names) {
  return {
    type: 'object',
    properties: Object.fromEntries(names.map((name) => [name, fields[name]])),
    required: names,
    additionalProperties: false,
  };
}

export function createSongCompletionSchema(song) {
  return responseSchema([
    ...(!song.title?.trim() ? ['title'] : []),
    ...(!song.style?.trim() ? ['style'] : []),
    ...(!song.lyrics?.trim() ? ['lyrics'] : []),
    ...(needsGenreTags(song) ? ['genres'] : []),
  ]);
}

export async function saveResponseSchema(folder, schema) {
  const file = path.join(folder, 'response-schema.json');
  await writeFile(file, JSON.stringify(schema, null, 2));
  return pathToFileURL(file);
}
