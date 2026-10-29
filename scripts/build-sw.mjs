// Lists every file the game needs and stamps sw.js with a content hash,
// so each change produces a new cache version and players get an update prompt.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', 'scripts', '.git', '.github', '.vercel', 'screenshots-src', 'assets']);
const SKIP_FILES = new Set(['sw.js', 'package.json', 'package-lock.json', 'README.md', 'vercel.json', 'serve.json', '.gitignore', '.nojekyll', 'LICENSE', 'OFL.txt']);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) out.push(...await walk(full)); }
    else if (!SKIP_FILES.has(entry.name)) out.push(full);
  }
  return out;
}

const files = (await walk(root)).sort();
const hash = createHash('sha256');
for (const f of files) { hash.update(relative(root, f)); hash.update(await readFile(f)); }
const version = hash.digest('hex').slice(0, 10);
// index.html is cached as './' (some hosts redirect /index.html to /, and redirected responses can't answer navigations)
const assets = ['./', ...files.map((f) => './' + relative(root, f).split(sep).join('/')).filter((p) => p !== './index.html' && !p.includes('/screenshot-'))]; // install-dialog screenshots aren't needed offline

const swPath = join(root, 'sw.js');
const sw = await readFile(swPath, 'utf8');
const block = `// <generated>\nconst VERSION = '${version}';\nconst ASSETS = ${JSON.stringify(assets, null, 2)};\n// </generated>`;
const next = sw.replace(/\/\/ <generated>[\s\S]*?\/\/ <\/generated>/, block);
if (next === sw && !sw.includes(version)) throw new Error('Could not find the <generated> block in sw.js');
await writeFile(swPath, next);
console.log(`sw.js → version ${version}, ${assets.length} files precached`);
