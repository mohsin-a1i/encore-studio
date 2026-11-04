import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sourceDirectory = fileURLToPath(new URL('../', import.meta.url));
async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map((entry) => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory() ? collectSourceFiles(filename) : filename;
    }),
  );
  return nestedFiles.flat().filter((filename) => /\.(mjs|js)$/.test(filename));
}
const sourceFiles = await collectSourceFiles(sourceDirectory);
for (const filename of sourceFiles) {
  execFileSync(process.execPath, ['--check', filename], { stdio: 'inherit', windowsHide: true });
  const source = await readFile(filename, 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
    await access(path.resolve(path.dirname(filename), match[1].split('?')[0]));
  }
}
console.log(`Syntax and local imports checked in ${sourceFiles.length} JavaScript files.`);
