import { config } from '../config.js';
import { geminiVerify } from './gemini.js';
import { glmMcpAnalyzeImage } from './glm-mcp.js';
import { groqVerify } from './groq.js';
import { VerificationServiceError } from '../errors.js';

const VERIFY_PROMPT =
  'Determine if this image is a legitimate industrial vibration graph (FFT spectrum, time waveform, orbit plot, Bode/Polar plot, SCADA vibration screen, or similar). ' +
  'Respond ONLY in valid JSON: {"is_legitimate": true/false, "reason": "brief explanation"}. ' +
  'If it is a personal photo, selfie, document text, or unrelated object, set is_legitimate to false.';

/**
 * Groq verification is delegated to services/groq.js (handles <think> stripping).
 * Kept here only for the dispatch table; see groqVerify import.
 */
// (groqVerify is imported above and dispatched in verifyVibrationGraph.)
function parseVerificationLenient(text) {
  // Try strict JSON first
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.is_legitimate === 'boolean') {
      return { is_legitimate: parsed.is_legitimate, reason: String(parsed.reason ?? '') };
    }
  } catch {
    /* fall through */
  }
  // Extract first {...} block
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (typeof parsed.is_legitimate === 'boolean') {
        return { is_legitimate: parsed.is_legitimate, reason: String(parsed.reason ?? '') };
      }
    } catch {
      /* fall through */
    }
  }
  // Heuristic: scan for true/false keywords
  const lower = text.toLowerCase();
  if (/is_legitimate.*true|"true"|legitimate/.test(lower) && !/not.*legitimate|false|unrelated|selfie|personal photo/.test(lower)) {
    return { is_legitimate: true, reason: text.slice(0, 300) };
  }
  return { is_legitimate: false, reason: text.slice(0, 300) };
}

/**
 * Parse a Gemini-style strict-JSON verification response.
 * Throws VerificationServiceError on empty / unparseable output.
 */
function parseVerificationStrict(raw) {
  if (!raw || !raw.trim()) {
    throw new VerificationServiceError('Verification model returned an empty response.');
  }
  const tryRead = (obj) => ({
    is_legitimate: Boolean(obj?.is_legitimate),
    reason: String(obj?.reason ?? ''),
    hasValidShape: typeof obj === 'object' && obj !== null && 'is_legitimate' in obj,
  });
  try {
    const out = tryRead(JSON.parse(raw));
    if (out.hasValidShape) return out;
  } catch { /* fall through */ }
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const out = tryRead(JSON.parse(match[0]));
      if (out.hasValidShape) return out;
    } catch { /* fall through */ }
  }
  throw new VerificationServiceError('Verification model returned unparseable output.');
}

/**
 * Tier 1 — Legitimacy verification, dispatched by VISION_PROVIDER.
 */
export async function verifyVibrationGraph({ base64, buffer, mimeType }) {
  let raw;
  let isLenient = false;

  if (config.visionProvider === 'glm-mcp') {
    isLenient = true;
    raw = await glmMcpAnalyzeImage(buffer, VERIFY_PROMPT, { guardVerification: true });
  } else if (config.visionProvider === 'groq') {
    raw = await groqVerify({ base64, mimeType });
  } else {
    raw = await geminiVerify({ base64, mimeType }); // may throw VerificationServiceError
  }

  const result = isLenient ? parseVerificationLenient(raw) : parseVerificationStrict(raw);
  return { ...result, raw };
}


