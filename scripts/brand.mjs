import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const brand = join(root, 'public/brand');
const icons = join(root, 'src-tauri/icons');
const cli = join(root, 'node_modules/@tauri-apps/cli/tauri.js');
const sizes = [16, 32, 64, 128, 256, 512, 1024];
const svg = (body, width = 256, height = width) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">${body}</svg>\n`;
const leaf = (green = '#398565', eye = '#F5FAF2', pupil = '#193E32') =>
  `<path d="M52 213C15 135 64 50 218 32C241 137 193 220 113 226C89 228 69 224 52 213Z" fill="${green}"/><path d="m74 198-34 38" stroke="${green}" stroke-width="17" stroke-linecap="round"/><path d="M70 132Q126 72 186 126Q135 186 70 132Z" fill="${eye}"/><circle cx="129" cy="128" r="22" fill="${pupil}"/>`;
const sprout = `<path d="M128 105C66 104 37 75 39 32C98 34 126 61 128 105Z" fill="#398565"/><path d="M128 105C133 59 164 39 218 44C209 88 180 109 128 105Z" fill="#69A783"/><rect x="52" y="100" width="152" height="126" rx="60" fill="#193E32"/><path d="M84 151q15-19 30 0m30 0q15-19 30 0" stroke="#F5FAF2" stroke-width="10" stroke-linecap="round"/><path d="M111 187q17 15 34 0" stroke="#F5FAF2" stroke-width="8" stroke-linecap="round"/>`;
const flutter = `<path d="m32 62 78 161C66 218 17 153 32 62Z" fill="#193E32"/><path d="M112 219C116 104 154 56 228 31C239 133 196 207 112 219Z" fill="#398565"/><path d="m49 47 21-15m8 42 27-10" stroke="#69A783" stroke-width="11" stroke-linecap="round"/>`;
// Original geometric letter paths; no font file or third-party logo is embedded.
const letters = [
  ['M2 6 24 62 46 6', 52],
  ['M0 6H46M23 6V62', 53],
  ['M4 25V46Q4 62 20 62Q36 62 36 46V25M36 46V62', 48],
  ['M4 4V62M4 43Q4 25 20 25Q38 25 38 43Q38 62 20 62Q4 62 4 43', 49],
  ['M5 43H38Q38 25 22 25Q4 25 4 44Q4 63 23 62Q33 62 38 57', 49],
  ['M4 6V62H42', 50],
  ['M5 43H38Q38 25 22 25Q4 25 4 44Q4 63 23 62Q33 62 38 57', 49],
  ['M37 43Q37 25 21 25Q4 25 4 43Q4 62 21 62Q37 62 37 43M37 25V62', 49],
  ['M12 62V20Q12 4 30 6M2 27H30', 38],
];
function wordmark(color) {
  let x = 8;
  return letters
    .map(([path, width]) => {
      const output = `<path d="${path}" transform="translate(${x} 5)" stroke="${color}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      x += width;
      return output;
    })
    .join('');
}

async function main() {
  await mkdir(join(brand, 'proposals'), { recursive: true });
  await mkdir(join(brand, 'png'), { recursive: true });
  await mkdir(icons, { recursive: true });
  for (const [name, body] of [
    ['leaf-eye', leaf()],
    ['sprout-face', sprout],
    ['flutter-v', flutter],
  ]) {
    await writeFile(join(brand, `proposals/${name}.svg`), svg(body));
  }
  const palettes = {
    light: ['#398565', '#F5FAF2', '#193E32'],
    dark: ['#8CCFA6', '#193E32', '#8CCFA6'],
    mono: ['#193E32', '#FFFFFF', '#193E32'],
  };
  for (const [name, colors] of Object.entries(palettes)) {
    await writeFile(join(brand, `mark-${name}.svg`), svg(leaf(...colors)));
    const ink = name === 'dark' ? '#E8F3E9' : '#193E32';
    await writeFile(join(brand, `wordmark-${name}.svg`), svg(wordmark(ink), 448, 80));
    await writeFile(
      join(brand, `lockup-${name}.svg`),
      svg(
        `<g transform="translate(0 0) scale(.375)">${leaf(...colors)}</g><g transform="translate(105 8)">${wordmark(ink)}</g>`,
        560,
        96,
      ),
    );
  }
  await copyFile(join(brand, 'mark-light.svg'), join(brand, 'mark.svg'));
  const board = `<rect width="960" height="960" fill="#F5F5EB"/><text x="55" y="65" font-family="sans-serif" font-size="30" fill="#193E32">VTubeLeaf · three original directions</text>${[
    ['01 / Leaf eye · provisional default', leaf()],
    ['02 / Sprout face', sprout],
    ['03 / Flutter V', flutter],
  ]
    .map(
      ([title, shape], index) =>
        `<g transform="translate(45 ${105 + index * 278})"><rect width="870" height="254" rx="24" fill="white"/><g transform="translate(15 0) scale(.9)">${shape}</g><text x="270" y="72" font-family="sans-serif" font-size="25" fill="#193E32">${title}</text><g transform="translate(285 110) scale(.0625)">${shape}</g><g transform="translate(340 104) scale(.125)">${shape}</g><g transform="translate(415 88) scale(.25)">${shape}</g><text x="275" y="190" font-family="sans-serif" font-size="16" fill="#546B5B">16 px / 32 px / 64 px · editable vector</text></g>`,
    )
    .join('')}`;
  await writeFile(join(brand, 'proposals.svg'), svg(board, 960));
  const temporary = await mkdtemp(join(tmpdir(), 'vtubeleaf-brand-'));
  const generate = (input, output, args = []) =>
    execFileSync(process.execPath, [cli, 'icon', input, '--output', output, ...args], {
      cwd: root,
      stdio: 'pipe',
    });
  try {
    generate(join(brand, 'mark.svg'), temporary);
    for (const name of [
      '32x32.png',
      '128x128.png',
      '128x128@2x.png',
      'icon.png',
      'icon.ico',
      'icon.icns',
    ]) {
      await copyFile(join(temporary, name), join(icons, name));
    }
    generate(
      join(brand, 'mark.svg'),
      join(brand, 'png'),
      sizes.flatMap((size) => ['--png', String(size)]),
    );
    generate(join(brand, 'proposals.svg'), temporary, ['--png', '960']);
    await copyFile(join(temporary, '960x960.png'), join(brand, 'proposals.png'));
    for (const size of sizes) {
      const bytes = await readFile(join(brand, 'png', `${size}x${size}.png`));
      assert.equal(bytes.readUInt32BE(16), size);
      assert.equal(bytes.readUInt32BE(20), size);
      assert.equal(bytes[25], 6, 'PNG must have RGBA channels');
    }
    assert.equal((await readFile(join(icons, 'icon.icns'))).subarray(0, 4).toString(), 'icns');
    assert.equal((await readFile(join(icons, 'icon.ico'))).readUInt32LE(0), 65536);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  console.log(
    'Brand SVGs and desktop icons exported; PNG dimensions, alpha channels and ICO/ICNS headers verified.',
  );
}

main().catch((error) => {
  console.error(error.message);
  if (error.stderr) console.error(error.stderr.toString());
  process.exitCode = 1;
});
