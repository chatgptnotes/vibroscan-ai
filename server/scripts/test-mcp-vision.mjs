// End-to-end GLM-4.6V vision test via the z.ai MCP server.
// Creates a synthetic FFT chart, writes it to a temp file, and calls
// analyze_data_visualization through the MCP protocol.
// Run: node scripts/test-mcp-vision.mjs
import sharp from 'sharp';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import dotenv from 'dotenv';
dotenv.config();

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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

const GLM_KEY = process.env.GLM_API_KEY;
if (!GLM_KEY) { console.error('GLM_API_KEY not set'); process.exit(1); }

// 1. Write chart to temp file.
const tmpDir = mkdtempSync(join(tmpdir(), 'vibrationcheck-mcp-'));
const imgPath = join(tmpDir, 'fft.png');
const pngBuf = await sharp(Buffer.from(FFT_SVG)).png().toBuffer();
writeFileSync(imgPath, pngBuf);
console.log(`Chart written to: ${imgPath} (${pngBuf.length} bytes)`);

// 2. Connect to MCP server.
console.log('\nSpawning MCP server (@z_ai/mcp-server)...');
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@z_ai/mcp-server@latest'],
  env: { ...process.env, Z_AI_API_KEY: GLM_KEY, Z_AI_MODE: 'ZAI' },
  timeout: 180000,
});
const client = new Client(
  { name: 'vibrationcheck-test', version: '1.0' },
  { capabilities: {}, timeout: 180000 },
);
await client.connect(transport);
console.log('Connected to MCP server.');

// 3. Call analyze_data_visualization with a 3-minute timeout.
console.log('\nCalling analyze_data_visualization...');
const t0 = Date.now();
try {
  const result = await client.callTool(
    {
      name: 'analyze_data_visualization',
      arguments: {
        image_source: imgPath,
        prompt: 'List every visible spectral peak with frequency (Hz) and amplitude. State the chart type.',
        analysis_focus: 'peaks',
      },
    },
    undefined,
    { timeout: 180000 },
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== GLM-4.6V RESULT (${elapsed}s) ===\n`);
  for (const item of result.content || []) {
    if (item.type === 'text') console.log(item.text);
  }
} catch (e) {
  console.log(`FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, e.message);
} finally {
  await client.close();
  try { unlinkSync(imgPath); } catch {}
}
