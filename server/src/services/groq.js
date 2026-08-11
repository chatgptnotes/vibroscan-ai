import { config } from '../config.js';
import { VerificationServiceError, DiagnosticServiceError } from '../errors.js';

/**
 * Groq — OpenAI-compatible API, very low latency (LPU).
 * Default model qwen/qwen3.6-27b is a reasoning model: it emits
 * <think>...</think> chain-of-thought blocks before the real answer, which
 * we strip out so downstream JSON/Markdown parsing isn't polluted.
 */

/** Remove <think>...</think> blocks (and any dangling unclosed one). */
export function stripThink(text) {
  if (!text) return '';
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  out = out.replace(/<think>[\s\S]*$/i, ''); // unclosed think at end
  return out.trim();
}

/**
 * Core Groq chat call. `content` is an OpenAI-style content array (so we can
 * include images). Returns the raw message content (with <think> stripped).
 */
export async function groqChat({ messages, temperature = 0, maxTokens = 2048, responseFormat }) {
  if (!config.groqApiKey) {
    throw new VerificationServiceError('GROQ_API_KEY is not configured.');
  }

  const body = {
    model: config.groqModel,
    messages,
    temperature,
    max_tokens: maxTokens,
    // Qwen is a reasoning model that emits <think> blocks. For the vision tasks
    // (verification + extraction) thinking is wasteful and burns the free-tier
    // token budget. Disable it — the actual diagnostic reasoning is done by the
    // downstream reasoning provider (GLM/Gemini), not by this vision pass.
    reasoning_effort: 'none',
  };
  if (responseFormat) body.response_format = responseFormat;

  let res;
  try {
    res = await fetch(`${config.groqBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.groqApiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (err) {
    throw new DiagnosticServiceError(`Groq request failed: ${err.message}`, { cause: err });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new DiagnosticServiceError(`Groq API error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? '';
  return stripThink(raw);
}

/** Tier-1 verification via Groq (JSON mode). Returns the JSON string. */
export async function groqVerify({ base64, mimeType }) {
  return groqChat({
    temperature: 0,
    maxTokens: 2048,
    responseFormat: { type: 'json_object' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Determine if this image is a legitimate industrial vibration graph (FFT spectrum, time waveform, orbit plot, Bode/Polar plot, SCADA vibration screen, or similar). ' +
              'Respond ONLY in valid JSON: {"is_legitimate": true/false, "reason": "brief explanation"}. ' +
              'If it is a personal photo, selfie, document text, or unrelated object, set is_legitimate to false.',
          },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      },
    ],
  });
}

/** Tier-2 extraction via Groq: produce a factual description of the chart. */
export async function groqExtractDescription({ base64, mimeType }) {
  return groqChat({
    temperature: 0,
    maxTokens: 4000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Examine this vibration graph and produce a dense factual description ONLY of what is visible. ' +
              'Report: chart/graph type, axis labels and units, axis ranges, all visible peaks with frequency/order and amplitude, ' +
              'harmonic markers (1X/2X/3X/nX), sidebands, anomalies. Do NOT diagnose — only describe. Use compact Markdown.',
          },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      },
    ],
  });
}
