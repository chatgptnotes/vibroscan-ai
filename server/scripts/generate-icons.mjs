// Generates PWA icons (PNG) from client/public/icon.svg using Sharp.
// Run from the server folder (which has sharp installed):
//   npm run make-icons
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svgPath = path.join(__dirname, '../../client/public/icon.svg');
const outDir = path.join(__dirname, '../../client/public');

const svgBuffer = await readFile(svgPath);

for (const size of [192, 512]) {
  await sharp(svgBuffer).resize(size, size).png().toFile(path.join(outDir, `icon-${size}.png`));
  console.log(`✓ generated icon-${size}.png`);
}

await sharp(svgBuffer).resize(64, 64).png().toFile(path.join(outDir, 'favicon.png'));
console.log('✓ generated favicon.png');
