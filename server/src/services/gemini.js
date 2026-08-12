import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';
import { VerificationServiceError, DiagnosticServiceError } from '../errors.js';
import { VERIFICATION_PROMPT } from '../prompts/verification.js';
import { EXTRACTION_PROMPT } from '../prompts/extraction.js';

// ── Retry helper for transient upstream errors (503/504/network) ──────────
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 2000;

function isTransient(err) {
  const msg = String(err?.message || '');
  return (
    err?.status === 503 ||
    err?.status === 504 ||
    /503|504|Service Unavailable|temporarily unavailable|high demand|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(msg)
  );
}

async function retryWithBackoff(fn, label) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES && isTransient(err)) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt); // 2s, 4s
        console.warn(`[retry] ${label} attempt ${attempt + 1}/${MAX_RETRIES + 1} failed (${err.message}); retrying in ${delay}ms…`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

let _client = null;
function client() {
  if (!_client) {
    if (!config.geminiApiKey) {
      throw new VerificationServiceError('GEMINI_API_KEY is not configured.');
    }
    _client = new GoogleGenerativeAI(config.geminiApiKey);
  }
  return _client;
}

function guardVerification(err) {
  // Network / auth / quota failures from the verification model are SERVICE
  // errors (502), not "image not a graph" verdicts (400).
  if (err instanceof VerificationServiceError) throw err;
  throw new VerificationServiceError(`Gemini verification call failed: ${err.message}`, {
    cause: err,
  });
}

function guardDiagnostic(err) {
  if (err instanceof DiagnosticServiceError) throw err;
  throw new DiagnosticServiceError(`Gemini diagnostic call failed: ${err.message}`, {
    cause: err,
  });
}

/**
 * Tier 1 — Legitimacy verification (low-latency, JSON output mode).
 * Returns the raw JSON string from the model.
 */
export async function geminiVerify({ base64, mimeType }) {
  try {
    return await retryWithBackoff(async () => {
      const model = client().getGenerativeModel({
        model: config.geminiVerificationModel,
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        requestOptions: { timeout: config.requestTimeoutMs },
      });

      const result = await model.generateContent([
        { text: VERIFICATION_PROMPT },
        { inlineData: { data: base64, mimeType } },
      ]);

      return result.response.text();
    }, 'geminiVerify');
  } catch (err) {
    guardVerification(err);
  }
}

/**
 * Deterministic path — structured FEATURE extraction only (no diagnosis).
 * Returns a parsed JSON object { chartType, axisX, axisY, peaks[], resonances[], ... }
 * that feeds the rule engine. Uses JSON output mode for guaranteed valid JSON.
 */
export async function geminiExtractStructured({ base64, mimeType }) {
  let raw;
  try {
    raw = await retryWithBackoff(async () => {
      const model = client().getGenerativeModel({
        model: config.geminiVerificationModel,
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        requestOptions: { timeout: config.requestTimeoutMs },
      });
      const result = await model.generateContent([
        { inlineData: { data: base64, mimeType } },
        { text: EXTRACTION_PROMPT },
      ]);
      return result.response.text();
    }, 'geminiExtractStructured');
  } catch (err) {
    guardDiagnostic(err);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new DiagnosticServiceError(
      `Deterministic extractor returned non-JSON output: ${(raw || '').slice(0, 200)}`,
      { cause: err }
    );
  }
}

/**
 * Tier 2 — Diagnostic reasoning. Returns Markdown.
 */
export async function geminiDiagnose({ base64, mimeType, prompt, systemInstruction }) {
  try {
    return await retryWithBackoff(async () => {
      const model = client().getGenerativeModel({
        model: config.geminiDiagnosticModel,
        generationConfig: { temperature: 0.2 },
        ...(systemInstruction ? { systemInstruction } : {}),
        requestOptions: { timeout: config.requestTimeoutMs },
      });

      const result = await model.generateContent([
        { inlineData: { data: base64, mimeType } },
        { text: prompt },
      ]);

      return result.response.text();
    }, 'geminiDiagnose');
  } catch (err) {
    guardDiagnostic(err);
  }
}

/**
 * Tier 2 (GLM path) — Gemini Vision produces a structured textual description
 * of the graph that a text-only GLM can reason over. Returns the description.
 */
export async function geminiExtractGraphDescription({ base64, mimeType }) {
  const EXTRACT_PROMPT =
    'You are a precision vision system. Examine this vibration graph and produce a dense, structured factual description ONLY of what is visible. Report: chart/graph type, axis labels and units, axis ranges/scales, all visible peaks with their frequency/order and approximate amplitude, harmonic markers (1X/2X/3X/nX), sidebands, and any anomalies. Do NOT diagnose — only describe what is literally drawn. Use compact Markdown.';

  try {
    return await retryWithBackoff(async () => {
      const model = client().getGenerativeModel({
        model: config.geminiVerificationModel,
        generationConfig: { temperature: 0 },
        requestOptions: { timeout: config.requestTimeoutMs },
      });
      const result = await model.generateContent([
        { inlineData: { data: base64, mimeType } },
        { text: EXTRACT_PROMPT },
      ]);
      return result.response.text();
    }, 'geminiExtractGraphDescription');
  } catch (err) {
    guardDiagnostic(err);
  }
}

/**
 * Tier 2 (Gemini, streaming) — yields text deltas as they arrive.
 */
export async function* geminiDiagnoseStream({ base64, mimeType, prompt, systemInstruction }) {
  try {
    const model = client().getGenerativeModel({
      model: config.geminiDiagnosticModel,
      generationConfig: { temperature: 0.2 },
      ...(systemInstruction ? { systemInstruction } : {}),
      requestOptions: { timeout: config.requestTimeoutMs },
    });
    const result = await model.generateContentStream([
      { inlineData: { data: base64, mimeType } },
      { text: prompt },
    ]);
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
  } catch (err) {
    guardDiagnostic(err);
  }
}

