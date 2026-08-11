import { config } from '../config.js';
import { DiagnosticServiceError } from '../errors.js';

// z.ai / Zhipu GLM — OpenAI-compatible API.
// IMPORTANT: this z.ai coding plan is TEXT-ONLY. GLM cannot read images.
// It is therefore used purely as a REASONING layer over a textual graph
// description produced upstream by Gemini Vision (see diagnostics.js).
async function glmChat({ messages, temperature = 0.2, responseFormat }) {
  if (!config.glmApiKey) {
    throw new DiagnosticServiceError('GLM_API_KEY is not configured.');
  }

  const url = `${config.glmBaseUrl}/chat/completions`;
  const body = {
    model: config.glmModel,
    messages,
    temperature,
    max_tokens: config.glmMaxTokens,
  };
  if (responseFormat) body.response_format = responseFormat;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.glmApiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (err) {
    throw new DiagnosticServiceError(`GLM request failed: ${err.message}`, { cause: err });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    let publicMessage;
    if (res.status === 429 || /1113|insufficient balance|no resource/i.test(detail)) {
      // GLM/z.ai account has no generation balance — distinct from a transient blip.
      publicMessage =
        'The GLM/z.ai account has insufficient balance or quota (HTTP 429). Please recharge the resource package on z.ai and retry, or switch DIAGNOSTIC_PROVIDER to gemini.';
    } else if (res.status === 401 || res.status === 403) {
      publicMessage = 'GLM authentication failed — check GLM_API_KEY in server/.env.';
    }
    throw new DiagnosticServiceError(`GLM API error ${res.status}: ${detail.slice(0, 300)}`, {
      publicMessage,
    });
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new DiagnosticServiceError('GLM returned an empty response.');
  }
  return content;
}

/**
 * Tier 2 (GLM) — Pure-text deep reasoning over a Gemini-produced graph
 * description + operator notes + the B&K rule base (passed as system message).
 * `prompt` is the user turn; `system` is the diagnostic rule base/persona.
 */
export async function glmReason({ system, prompt }) {
  return glmChat({
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
  });
}

/**
 * Tier 2 (GLM, streaming) — OpenAI-compatible SSE. Yields text deltas.
 */
export async function* glmReasonStream({ system, prompt }) {
  if (!config.glmApiKey) {
    throw new DiagnosticServiceError('GLM_API_KEY is not configured.');
  }
  const url = `${config.glmBaseUrl}/chat/completions`;
  const body = {
    model: config.glmModel,
    temperature: 0.2,
    max_tokens: config.glmMaxTokens,
    stream: true,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.glmApiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (err) {
    throw new DiagnosticServiceError(`GLM request failed: ${err.message}`, { cause: err });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new DiagnosticServiceError(`GLM API error ${res.status}: ${detail.slice(0, 300)}`, {
      publicMessage:
        res.status === 429
          ? 'The GLM/z.ai account has insufficient balance or quota (HTTP 429). Recharge the resource package on z.ai, or switch DIAGNOSTIC_PROVIDER to gemini.'
          : undefined,
    });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          /* ignore keepalive / partial JSON */
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
}

