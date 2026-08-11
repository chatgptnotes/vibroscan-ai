// SSE stream smoke test for /api/analyze-stream. Run: node scripts/smoke-stream.mjs
import sharp from 'sharp';

const API = process.env.API_URL || 'http://localhost:3001/api/analyze-stream';

const FFT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480" viewBox="0 0 800 480" font-family="Arial, sans-serif">
  <rect width="800" height="480" fill="#ffffff"/>
  <text x="400" y="36" text-anchor="middle" font-size="22" font-weight="bold" fill="#111">FFT SPECTRUM — Vibration Velocity</text>
  <rect x="80" y="60" width="680" height="340" fill="none" stroke="#333" stroke-width="2"/>
  <text x="420" y="445" text-anchor="middle" font-size="16" fill="#333">Frequency (Hz)</text>
  <text x="26" y="230" text-anchor="middle" font-size="16" fill="#333" transform="rotate(-90 26 230)">Velocity (mm/s)</text>
  <line x1="180" y1="400" x2="180" y2="110" stroke="#2563eb" stroke-width="10"/><text x="180" y="98" text-anchor="middle" font-size="13" fill="#2563eb">1X 25Hz 8.5</text>
  <line x1="305" y1="400" x2="305" y2="250" stroke="#2563eb" stroke-width="10"/><text x="305" y="240" text-anchor="middle" font-size="13" fill="#2563eb">2X 50Hz 3.5</text>
  <line x1="430" y1="400" x2="430" y2="320" stroke="#2563eb" stroke-width="10"/><text x="430" y="310" text-anchor="middle" font-size="13" fill="#2563eb">3X 75Hz 1.8</text>
  <line x1="555" y1="400" x2="555" y2="360" stroke="#16a34a" stroke-width="8"/><text x="555" y="352" text-anchor="middle" font-size="12" fill="#16a34a">BPFO</text>
</svg>`;

const buf = await sharp(Buffer.from(FFT_SVG)).png().toBuffer();

const form = new FormData();
form.append('image', new Blob([buf], { type: 'image/png' }), 'chart.png');
form.append('description', 'Induction motor, 1500 RPM, DE bearing vibration rising.');

const t0 = Date.now();
const res = await fetch(API, { method: 'POST', body: form });
console.log('HTTP', res.status, 'content-type:', res.headers.get('content-type'));

if (!res.ok || !res.body) {
  console.log(await res.text());
  process.exit(1);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let assembled = '';
let chunkCount = 0;

for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let idx;
  while ((idx = buffer.indexOf('\n\n')) >= 0) {
    const raw = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    let event = 'message';
    let dataStr = '';
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
    }
    let data;
    try {
      data = dataStr ? JSON.parse(dataStr) : {};
    } catch {
      data = { raw: dataStr };
    }
    if (event === 'chunk') {
      chunkCount++;
      assembled += data.text || '';
      if (chunkCount <= 3 || chunkCount % 10 === 0) {
        console.log(`  [chunk #${chunkCount} @${Date.now() - t0}ms] +${(data.text || '').length} chars`);
      }
    } else {
      console.log(`  <${event}>`, JSON.stringify(data));
    }
  }
}
console.log(`\nDone in ${Date.now() - t0}ms. Total chunks: ${chunkCount}, ${assembled.length} chars.`);
console.log('Report head:\n' + assembled.slice(0, 400));
