import { readFile, writeFile, mkdir, readdir, copyFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createCoverArtwork, coverPaletteIds } from '../library/cover-artwork.mjs';

export async function regenerateCovers({ dataRoot, backupRoot }) {
  const indexPath = path.join(dataRoot, 'library.json');
  const library = JSON.parse(await readFile(indexPath, 'utf8'));
  const entities = [];
  for (const folder of await readdir(path.join(dataRoot, 'songs'), { withFileTypes: true })) {
    if (!folder.isDirectory() || library.deletedSongIds?.includes(folder.name)) continue;
    const metadata = path.join(dataRoot, 'songs', folder.name, 'song.json');
    const song = JSON.parse(await readFile(metadata, 'utf8'));
    if (song.job?.phase || song.referencePreparation?.phase)
      throw new Error('Finish active song work before replacing covers.');
    entities.push({ kind: 'song', record: song, metadata, folder: path.dirname(metadata) });
  }
  for (const playlist of library.playlists || [])
    entities.push({
      kind: 'playlist',
      record: playlist,
      folder: path.join(dataRoot, 'playlists', playlist.id),
    });
  entities.sort((a, b) => `${a.kind}:${a.record.id}`.localeCompare(`${b.kind}:${b.record.id}`));
  const originals = new Map();
  const backup = async (file) => {
    if (originals.has(file)) return;
    const relative = path.relative(dataRoot, file);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('Cover is outside the library.');
    const destination = path.join(backupRoot, relative);
    try {
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(file, destination);
      originals.set(file, destination);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      originals.set(file, null);
    }
  };
  await backup(indexPath);
  for (const entity of entities) {
    if (entity.metadata) await backup(entity.metadata);
    if (entity.record.coverFile) await backup(path.resolve(entity.folder, entity.record.coverFile));
    await backup(path.join(entity.folder, 'cover.svg'));
  }
  const manifest = {
    createdAt: new Date().toISOString(),
    songs: 0,
    playlists: 0,
    palettes: {},
    files: [...originals].map(([file, original]) => ({ file, original })),
  };
  const atomicWrite = async (file, contents) => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file + '.cover-tmp', contents);
    await rename(file + '.cover-tmp', file);
  };
  try {
    for (const [index, entity] of entities.entries()) {
      const paletteId = coverPaletteIds[index % coverPaletteIds.length];
      const { record, kind, folder } = entity;
      await atomicWrite(
        path.join(folder, 'cover.svg'),
        createCoverArtwork({
          id: record.id,
          title: record.title || record.name,
          subtitle: kind === 'song' ? record.genres?.[0] || 'ENCORE ORIGINAL' : 'ENCORE PLAYLIST',
          seed: record.id,
          paletteId,
        }),
      );
      record.coverFile = kind === 'song' ? 'cover.svg' : path.join(folder, 'cover.svg');
      record.coverVersion = randomUUID();
      record.coverPalette = paletteId;
      if (entity.metadata)
        await atomicWrite(entity.metadata, JSON.stringify(record, null, 2) + '\n');
      manifest[kind === 'song' ? 'songs' : 'playlists']++;
      manifest.palettes[paletteId] = (manifest.palettes[paletteId] || 0) + 1;
    }
    await atomicWrite(indexPath, JSON.stringify(library, null, 2) + '\n');
    await writeFile(
      path.join(backupRoot, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    return manifest;
  } catch (error) {
    for (const [file, original] of originals) {
      if (original) await copyFile(original, file);
      else await rm(file, { force: true });
    }
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!process.argv.includes('--apply'))
    throw new Error('Use --apply with Encore stopped to replace all covers.');
  let online = false;
  try {
    await fetch('http://127.0.0.1:4318/api/health', { signal: AbortSignal.timeout(1500) });
    online = true;
  } catch {}
  if (online) throw new Error('Stop Encore before replacing library covers.');
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const backupRoot = path.join(
    root,
    '.sites-runtime',
    'cover-backups',
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  const result = await regenerateCovers({ dataRoot: path.join(root, 'data'), backupRoot });
  console.log(JSON.stringify({ ...result, files: result.files.length, backupRoot }, null, 2));
}
