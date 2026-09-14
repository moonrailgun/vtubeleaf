import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function createUpdaterManifest(directory, tag, notes) {
  assert.match(tag, /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  const version = tag.slice(1);
  const artifact = async (name) => {
    assert.ok((await stat(join(directory, name))).size > 0, `Empty update: ${name}`);
    const signature = (await readFile(join(directory, `${name}.sig`), 'utf8')).trim();
    assert.match(signature, /^[A-Za-z0-9+/]+={0,2}$/, `Missing signature: ${name}`);
    return {
      signature,
      url: `https://github.com/moonrailgun/vtubeleaf/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`,
    };
  };
  const windows = await artifact(`VTubeLeaf_${version}_x64-setup.exe`);
  const mac = await artifact(`VTubeLeaf-${version}-macos-universal.app.tar.gz`);
  return {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: { 'windows-x86_64': windows, 'darwin-aarch64': mac, 'darwin-x86_64': mac },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, tag, notesFile] = process.argv.slice(2);
  const manifest = await createUpdaterManifest(directory, tag, await readFile(notesFile, 'utf8'));
  await writeFile(join(directory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
