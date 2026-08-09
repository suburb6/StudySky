import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const screenshotPath = join(root, 'docs', 'assets', 'screenshots', 'today.png');
const iconPath = join(root, 'static', 'favicon.svg');
const outputPath = join(root, 'docs', 'assets', 'social-preview.png');

const screenshotWidth = 748;
const screenshotHeight = 426;
const screenshot = await sharp(screenshotPath)
  .extract({ left: 0, top: 0, width: 1440, height: 820 })
  .resize({ width: screenshotWidth, height: screenshotHeight, fit: 'fill' })
  .png()
  .toBuffer();
const roundedScreenshot = await sharp(screenshot)
  .composite([
    {
      input: Buffer.from(
        `<svg width="${screenshotWidth}" height="${screenshotHeight}"><rect width="100%" height="100%" rx="18" fill="white"/></svg>`
      ),
      blend: 'dest-in'
    }
  ])
  .png()
  .toBuffer();
const icon = await sharp(iconPath).resize(62, 62).png().toBuffer();

const backdrop = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
    <defs>
      <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fbfaf8"/>
        <stop offset="1" stop-color="#f3f0eb"/>
      </linearGradient>
      <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(1160 40) rotate(135) scale(460)">
        <stop stop-color="#fff0df" stop-opacity="0.95"/>
        <stop offset="1" stop-color="#fff0df" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1280" height="640" fill="url(#background)"/>
    <rect width="1280" height="640" fill="url(#glow)"/>
    <rect width="1280" height="8" fill="#c4630c"/>
    <g fill="none" stroke="#d9d5cf" stroke-opacity="0.42">
      <path d="M0 560H1280"/>
      <path d="M360 8V640"/>
    </g>
    <text x="72" y="174" fill="#75716b" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700" letter-spacing="2">OPEN-SOURCE · SELF-HOSTED</text>
    <text x="72" y="235" fill="#151515" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="700">StudySky</text>
    <text x="72" y="292" fill="#151515" font-family="Arial, Helvetica, sans-serif" font-size="29" font-weight="650">Your studies,</text>
    <text x="72" y="329" fill="#151515" font-family="Arial, Helvetica, sans-serif" font-size="29" font-weight="650">organised.</text>
    <text x="72" y="382" fill="#5f5b55" font-family="Arial, Helvetica, sans-serif" font-size="18">A focused workspace for modules,</text>
    <text x="72" y="408" fill="#5f5b55" font-family="Arial, Helvetica, sans-serif" font-size="18">tasks, revision, notes, and time.</text>
    <g font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="700">
      <rect x="72" y="452" width="125" height="36" rx="18" fill="#fff" stroke="#ddd8d1"/>
      <text x="92" y="475" fill="#37352f">Privacy-first</text>
      <rect x="207" y="452" width="118" height="36" rx="18" fill="#fff3e6" stroke="#e6b684"/>
      <text x="228" y="475" fill="#9b4b05">AGPL-3.0</text>
    </g>
    <rect x="466" y="86" width="764" height="442" rx="22" fill="#17130f" fill-opacity="0.09"/>
    <rect x="460" y="78" width="764" height="442" rx="22" fill="#ffffff" stroke="#d9d5cf"/>
  </svg>
`);

await sharp(backdrop)
  .composite([
    { input: icon, left: 72, top: 70 },
    { input: roundedScreenshot, left: 468, top: 86 }
  ])
  .png({ compressionLevel: 9, palette: true, quality: 92 })
  .toFile(outputPath);

console.log(`Rendered ${outputPath}`);
