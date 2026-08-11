// Builds two test images (a solid "non-graph" + a synthetic FFT spectrum chart)
// and POSTs them to the running API. Run: node scripts/smoke.mjs <which>
//   which = reject  -> POST only the non-graph (fast; expects 400 verified:false)
//   which = chart   -> POST the synthetic FFT chart (full pipeline; slower)
import sharp from 'sharp';

const API = process.env.API_URL || 'http://localhost:3001/api/analyze-vibration';

async function buildNonGraph() {
  return sharp({ create: { width: 240, height: 240, channels: 3, background: '#ef4444' } })
    .png()
    .toBuffer();
}

// A textbook-looking FFT spectrum chart so Tier-1 verification passes.
const FFT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480" viewBox="0 0 800 480" font-family="Arial, sans-serif">
  <rect width="800" height="480" fill="#ffffff"/>
  <text x="400" y="36" text-anchor="middle" font-size="22" font-weight="bold" fill="#111">FFT SPECTRUM — Vibration Velocity</text>
  <rect x="80" y="60" width="680" height="340" fill="none" stroke="#333" stroke-width="2"/>
  ${Array.from({ length: 17 }, (_, i) => `<line x1="${80 + i * 42.5}" y1="60" x2="${80 + i * 42.5}" y2="400" stroke="#e5e7eb"/>`).join('')}
  ${Array.from({ length: 9 }, (_, i) => `<line x1="80" y1="${60 + i * 42.5}" x2="760" y2="${60 + i * 42.5}" stroke="#e5e7eb"/>`).join('')}
  <text x="420" y="445" text-anchor="middle" font-size="16" fill="#333">Frequency (Hz)</text>
  <text x="26" y="230" text-anchor="middle" font-size="16" fill="#333" transform="rotate(-90 26 230)">Velocity (mm/s)</text>
  <line x1="180" y1="400" x2="180" y2="110" stroke="#2563eb" stroke-width="10"/><text x="180" y="98" text-anchor="middle" font-size="13" fill="#2563eb">1X 25Hz 8.5</text>
  <line x1="305" y1="400" x2="305" y2="250" stroke="#2563eb" stroke-width="10"/><text x="305" y="240" text-anchor="middle" font-size="13" fill="#2563eb">2X 50Hz 3.5</text>
  <line x1="430" y1="400" x2="430" y2="320" stroke="#2563eb" stroke-width="10"/><text x="430" y="310" text-anchor="middle" font-size="13" fill="#2563eb">3X 75Hz 1.8</text>
  <line x1="555" y1="400" x2="555" y2="360" stroke="#16a34a" stroke-width="8"/><text x="555" y="352" text-anchor="middle" font-size="12" fill="#16a34a">BPFO</text>
  ${Array.from({ length: 16 }, (_, i) => `<text x="${80 + i * 42.5}" y="418" text-anchor="middle" font-size="11" fill="#555">${i * 5}</text>`).join('')}
</svg>`;

async function buildChart() {
  return sharp(Buffer.from(FFT_SVG)).png().toBuffer();
}

async function post(label, buf, description = '') {
  const form = new FormData();
  form.append('image', new Blob([buf], { type: 'image/png' }), 'chart.png');
  if (description) form.append('description', description);

  const t0 = Date.now();
  const res = await fetch(API, { method: 'POST', body: form });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  const ms = Date.now() - t0;
  console.log(`\n[${label}] HTTP ${res.status}  (${ms} ms)`);
  if (res.ok) {
    console.log('  verified:', data.verified, '| provider:', data.provider, '| model:', data.model);
    console.log('  report (first 600 chars):\n' + String(data.report || '').slice(0, 600));
  } else {
    console.log('  verified:', data.verified, '| error:', data.error);
    console.log('  reason:', data.reason);
  }
}

const which = process.argv[2] || 'reject';

if (which === 'reject') {
  await post('non-graph (expect 400 verified:false)', await buildNonGraph());
} else if (which === 'chart') {
  await post('FFT chart (expect 200 + report)', await buildChart(), 'Induction motor, 1500 RPM, DE bearing vibration rising.');
} else {
  console.error('usage: node scripts/smoke.mjs reject|chart');
  process.exit(1);
}
