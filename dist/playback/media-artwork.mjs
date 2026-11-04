import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  access,
  lstat,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { mediaArtworkSizes } from './media-artwork.js';

const pendingArtwork = new Map();

async function prepareArtwork(source, folder, size) {
  const bytes = await readFile(source);
  const sourceHash = createHash('sha256').update(bytes).digest('hex');
  const cache = path.join(folder, 'media-artwork');
  const image = path.join(cache, `${size}.png`);
  // The song folder must already exist; a deleted song is never recreated here.
  await mkdir(cache).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
  if (
    (await lstat(cache)).isSymbolicLink() ||
    path.dirname(await realpath(cache)) !== (await realpath(folder))
  )
    throw new Error('Unsafe media artwork folder.');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(cache, 'source.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  if (
    manifest?.sourceHash === sourceHash &&
    (await access(image).then(
      () => true,
      () => false,
    ))
  )
    return image;
  const temporary = [];
  try {
    for (const pixels of mediaArtworkSizes) {
      const output = path.join(cache, `${pixels}.png`);
      const partial = `${output}.${randomUUID()}.tmp`;
      temporary.push(partial);
      await sharp(bytes, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(pixels, pixels, { fit: 'cover' })
        .flatten({ background: '#111111' })
        .png()
        .toFile(partial);
      await rename(partial, output);
    }
    const metadata = path.join(cache, `source.${randomUUID()}.tmp`);
    temporary.push(metadata);
    await writeFile(metadata, JSON.stringify({ sourceHash }) + '\n');
    await rename(metadata, path.join(cache, 'source.json'));
  } finally {
    await Promise.all(
      temporary.map((file) =>
        unlink(file).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        }),
      ),
    );
  }
  return image;
}

export async function getMediaArtworkFile(source, folder, size) {
  if (!mediaArtworkSizes.includes(size)) throw new Error('Unsupported media artwork size.');
  // Serialize requests per song so OS requests for several sizes share one render.
  const previous = pendingArtwork.get(folder) || Promise.resolve();
  const pending = previous.catch(() => {}).then(() => prepareArtwork(source, folder, size));
  pendingArtwork.set(folder, pending);
  try {
    return await pending;
  } finally {
    if (pendingArtwork.get(folder) === pending) pendingArtwork.delete(folder);
  }
}
