import { config } from '../config.js';
import {
  DIAGNOSTIC_SYSTEM,
  geminiUserTurn,
  glmUserTurn,
} from '../prompts/diagnostic.js';
import { geminiDiagnose, geminiDiagnoseStream, geminiExtractGraphDescription } from './gemini.js';
import { glmReason, glmReasonStream } from './glm.js';
import { glmMcpAnalyzeImage } from './glm-mcp.js';

const EXTRACT_PROMPT =
  'Examine this vibration graph and produce a dense factual description ONLY of what is visible. Report: chart/graph type, axis labels and units, axis ranges, all visible peaks with frequency/order and amplitude, harmonic markers (1X/2X/3X/nX), sidebands, anomalies. Do NOT diagnose — only describe. Use compact Markdown.';

/**
 * Extract a structured graph description using the configured VISION_PROVIDER.
 */
async function extractGraphDescription({ base64, mimeType, buffer }) {
  if (config.visionProvider === 'glm-mcp') {
    return glmMcpAnalyzeImage(buffer, EXTRACT_PROMPT, { analysisFocus: 'peaks and frequencies' });
  }
  // gemini (default) and groq both use Gemini's inline extraction path
  return geminiExtractGraphDescription({ base64, mimeType });
}

/**
 * Tier 2 — Diagnostic Reasoning Engine.
 *
 * Paths:
 *  - diagnosticProvider=gemini: Gemini reads the image directly + reasons.
 *  - diagnosticProvider=glm: vision provider extracts a graph description,
 *    then GLM reasons over it (B&K rule base as system message).
 */
export async function runDiagnostics({ base64, mimeType, buffer, userDescription }) {
  if (config.diagnosticProvider === 'glm') {
    const graphDescription = await extractGraphDescription({ base64, mimeType, buffer });
    const report = await glmReason({
      system: DIAGNOSTIC_SYSTEM,
      prompt: glmUserTurn(graphDescription, userDescription),
    });
    return {
      provider: 'glm',
      model: config.glmModel,
      report,
    };
  }

  const report = await geminiDiagnose({
    base64,
    mimeType,
    systemInstruction: DIAGNOSTIC_SYSTEM,
    prompt: geminiUserTurn(userDescription),
  });

  return {
    provider: 'gemini',
    model: config.geminiDiagnosticModel,
    report,
  };
}

/**
 * Streaming variant — an async generator yielding Markdown text deltas.
 */
export async function* runDiagnosticsStream({ base64, mimeType, buffer, userDescription }) {
  if (config.diagnosticProvider === 'glm') {
    const graphDescription = await extractGraphDescription({ base64, mimeType, buffer });
    yield* glmReasonStream({
      system: DIAGNOSTIC_SYSTEM,
      prompt: glmUserTurn(graphDescription, userDescription),
    });
    return;
  }
  yield* geminiDiagnoseStream({
    base64,
    mimeType,
    systemInstruction: DIAGNOSTIC_SYSTEM,
    prompt: geminiUserTurn(userDescription),
  });
}


