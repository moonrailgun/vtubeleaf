import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const brand = join(root, 'public/brand');
const icons = join(root, 'src-tauri/icons');
const websiteBrand = join(root, 'website/public/assets/brand');
const cli = join(root, 'node_modules/@tauri-apps/cli/tauri.js');
const sizes = [16, 32, 64, 128, 256, 512, 1024];
const svg = (body, width = 256, height = width) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">${body}</svg>\n`;
// Editable vector of the selected 02 sprout spirit, with opaque white eyes and smile.
const sprout = (pink = '#E15F7D', highlight = '#F6B5BE') =>
  `<g transform="translate(27.4 16) scale(.336) translate(-321 -193)">
    <g fill="${pink}">
      <path d="M696 434C683 397 679 364 656 337C621 295 568 275 514 286C521 355 557 401 623 416C637 419 650 423 667 432C660 400 632 367 596 340C639 359 676 393 691 436Z"/>
      <path d="M699 435C677 358 695 288 749 248C789 218 851 203 916 194C926 258 920 323 884 370C850 414 792 433 736 454C719 408 767 333 818 292C746 328 710 378 699 435Z"/>
      <path d="M694 434C626 407 552 416 494 448C443 477 424 515 399 551C375 588 355 607 326 602C309 597 328 633 351 643C365 650 381 653 394 652C377 716 388 777 430 813C475 852 545 861 618 860C716 861 811 840 868 795C900 770 908 735 890 702C877 680 874 670 872 643C866 558 824 490 736 454Z"/>
    </g>
    <path d="M421 638C482 622 532 587 558 537C568 584 551 614 521 632C491 651 453 651 421 638Z" fill="${highlight}"/>
    <g fill="#FFFFFF">
      <ellipse cx="527" cy="727" rx="20" ry="42" transform="rotate(-9 527 727)"/>
      <ellipse cx="722" cy="691" rx="20" ry="42" transform="rotate(-9 722 691)"/>
    </g>
    <path d="M607 756Q632 773 658 746" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round"/>
  </g>`;
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
  await mkdir(join(brand, 'png'), { recursive: true });
  await mkdir(icons, { recursive: true });
  await mkdir(websiteBrand, { recursive: true });
  const palettes = {
    light: ['#E15F7D', '#F6B5BE'],
    dark: ['#E15F7D', '#F6B5BE'],
    mono: ['#493C45', '#FFFFFF'],
  };
  for (const [name, colors] of Object.entries(palettes)) {
    await writeFile(join(brand, `mark-${name}.svg`), svg(sprout(...colors)));
    const ink = name === 'dark' ? '#F6EAF0' : '#493C45';
    await writeFile(join(brand, `wordmark-${name}.svg`), svg(wordmark(ink), 448, 80));
    await writeFile(
      join(brand, `lockup-${name}.svg`),
      svg(
        `<g transform="translate(0 0) scale(.375)">${sprout(...colors)}</g><g transform="translate(105 8)">${wordmark(ink)}</g>`,
        560,
        96,
      ),
    );
  }
  await copyFile(join(brand, 'mark-light.svg'), join(brand, 'mark.svg'));
  for (const [source, target] of [
    ['mark.svg', 'mark-rose.svg'],
    ['lockup-light.svg', 'lockup-rose.svg'],
    ['lockup-dark.svg', 'lockup-rose-dark.svg'],
  ]) {
    await copyFile(join(brand, source), join(websiteBrand, target));
  }
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
