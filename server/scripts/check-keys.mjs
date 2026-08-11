// Live probe of both providers. Run: node scripts/check-keys.mjs
import dotenv from 'dotenv';
dotenv.config();

const mask = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-4)} (len ${k.length})` : '(missing)');
function line(ok, msg) {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
}

// 1x1 red pixel PNG (tiny but valid) for vision probes.
const PIXEL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function testGemini() {
  console.log('\n=== GEMINI (Google AI Studio) ===');
  const key = process.env.GEMINI_API_KEY || '';
  console.log(`  key: ${mask(key)}`);
  if (!key) { line(false, 'GEMINI_API_KEY not set.'); return; }

  // 1) REST model listing (the SDK method differs across versions).
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`
    );
    const data = await r.json();
    const names = (data?.models || []).map((m) => m.name).filter((n) => /gemini/i.test(n));
    const usable = names.filter((n) => /1\.5|2\./i.test(n));
    if (r.ok) line(true, `model listing OK — ${names.length} models, incl: ${usable.join(', ')}`);
    else line(false, `model listing ${r.status}: ${JSON.stringify(data?.error || data).slice(0, 200)}`);
  } catch (e) {
    line(false, `model listing request FAILED: ${e.message}`);
  }

  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const ai = new GoogleGenerativeAI(key);

  for (const model of [
    process.env.GEMINI_VERIFICATION_MODEL || 'gemini-1.5-flash',
    process.env.GEMINI_DIAGNOSTIC_MODEL || 'gemini-1.5-pro',
  ]) {
    // text
    try {
      const m = ai.getGenerativeModel({ model, generationConfig: { temperature: 0 } });
      const r = await m.generateContent('Reply with one word: OK');
      line(true, `${model} text OK → ${r.response.text().trim().slice(0, 30)}`);
    } catch (e) {
      line(false, `${model} text FAILED: ${e.message}`);
    }
    // vision
    try {
      const m = ai.getGenerativeModel({ model, generationConfig: { temperature: 0 } });
      const r = await m.generateContent([
        { inlineData: { data: PIXEL_PNG_B64, mimeType: 'image/png' } },
        { text: 'Reply with one word: OK' },
      ]);
      line(true, `${model} vision OK → ${r.response.text().trim().slice(0, 30)}`);
    } catch (e) {
      line(false, `${model} vision FAILED: ${e.message}`);
    }
  }
}

async function testGlm() {
  console.log('\n=== GLM (z.ai Coding Plan) ===');
  const key = process.env.GLM_API_KEY || '';
  // Coding Plan requires its DEDICATED endpoint (not the PAYG /api/paas/v4).
  const base = (
    process.env.GLM_BASE_URL || 'https://api.z.ai/api/coding/paas/v4'
  ).replace(/\/+$/, '');
  console.log(`  key : ${mask(key)}\n  base: ${base}`);
  if (!key) { line(false, 'GLM_API_KEY not set.'); return; }

  // Text-reasoning probe (the Coding Plan is TEXT-ONLY — no vision).
  // These are reasoning models, so they need a generous max_tokens.
  const model = process.env.GLM_MODEL || 'glm-4.6';
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        temperature: 0,
        messages: [
          { role: 'system', content: 'Be terse.' },
          { role: 'user', content: 'Reply with one word: OK' },
        ],
      }),
    });
    const txt = await r.text();
    if (r.ok) {
      const data = JSON.parse(txt);
      const c = data?.choices?.[0]?.message?.content || '(empty)';
      const reasoning = data?.choices?.[0]?.message?.reasoning_content;
      line(true, `${model} reasoning OK → "${String(c).trim().slice(0, 40)}"`);
      if (reasoning) {
        const rt = data?.usage?.completion_tokens_details?.reasoning_tokens || '?';
        console.log(`     (reasoning model: ${rt} thinking tokens emitted)`);
      }
    } else {
      const hint =
        r.status === 429 && /1113|insufficient/i.test(txt)
          ? ' → wrong endpoint? Coding Plan needs /api/coding/paas/v4, NOT /api/paas/v4'
          : '';
      line(false, `${model} ${r.status}: ${txt.slice(0, 120)}${hint}`);
    }
  } catch (e) {
    line(false, `${model} request FAILED: ${e.message}`);
  }
}

await testGemini();
await testGlm();
console.log('\nDone.');

