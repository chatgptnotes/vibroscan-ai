import { config } from '../config.js';
import {
  DIAGNOSTIC_SYSTEM,
  geminiUserTurn,
  glmUserTurn,
} from '../prompts/diagnostic.js';
import { geminiDiagnose, geminiDiagnoseStream, geminiExtractGraphDescription, geminiExtractStructured } from './gemini.js';
import { glmReason, glmReasonStream } from './glm.js';
import { glmMcpAnalyzeImage } from './glm-mcp.js';
import { groqExtractDescription } from './groq.js';
import { evaluateRules, renderDeterministicReport } from './ruleEngine.js';

const EXTRACT_PROMPT =
  'Examine this vibration graph and produce a dense factual description ONLY of what is visible. Report: chart/graph type, axis labels and units, axis ranges, all visible peaks with frequency/order and amplitude, harmonic markers (1X/2X/3X/nX), sidebands, anomalies. Do NOT diagnose — only describe. Use compact Markdown.';

/**
 * Extract a structured graph description using the configured VISION_PROVIDER.
 */
async function extractGraphDescription({ base64, mimeType, buffer }) {
  if (config.visionProvider === 'glm-mcp') {
    return glmMcpAnalyzeImage(buffer, EXTRACT_PROMPT, { analysisFocus: 'peaks and frequencies' });
  }
  if (config.visionProvider === 'groq') {
    return groqExtractDescription({ base64, mimeType });
  }
  // gemini (default)
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
  // ── Deterministic path: vision extracts structured features → fixed rule code ──
  if (config.diagnosticProvider === 'deterministic') {
    const extraction = await geminiExtractStructured({ base64, mimeType });
    const evaluation = evaluateRules(extraction);
    const report = renderDeterministicReport(extraction, evaluation);
    return {
      provider: 'deterministic',
      model: 'rule-engine-v1',
      report,
    };
  }

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
  // ── Deterministic path: computed in one shot, then streamed in sections ──
  if (config.diagnosticProvider === 'deterministic') {
    const extraction = await geminiExtractStructured({ base64, mimeType });
    const evaluation = evaluateRules(extraction);
    const report = renderDeterministicReport(extraction, evaluation);
    // Yield section-by-section so the UI keeps its progressive "typing" feel.
    const sections = report.split('\n\n');
    for (const section of sections) {
      yield section + '\n\n';
    }
    return;
  }

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


