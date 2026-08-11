import dotenv from 'dotenv';

dotenv.config();

const toInt = (val, fallback) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: toInt(process.env.PORT, 3001),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',

  // ── Gemini (default + Tier-1 provider) ──────────────────────────────
  // NOTE: gemini-1.5-* / gemini-2.5-* are decommissioned on current keys.
  // The "-latest" aliases auto-point to the newest model this key can access
  // and have been verified for vision + JSON output mode.
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiVerificationModel: process.env.GEMINI_VERIFICATION_MODEL || 'gemini-flash-latest',
  geminiDiagnosticModel: process.env.GEMINI_DIAGNOSTIC_MODEL || 'gemini-flash-latest',

  // ── GLM / z.ai Coding Plan (optional Tier-2 *reasoning* provider) ────
  // IMPORTANT: the z.ai Coding Plan key is TEXT-ONLY (no vision) AND only works
  // on the Coding-Plan DEDICATED endpoints (not the PAYG /api/paas/v4 path,
  // which returns 429 "insufficient balance"):
  //   - OpenAI-compatible: https://api.z.ai/api/coding/paas/v4   (used here)
  //   - Anthropic-compat:  https://api.z.ai/api/anthropic
  // When DIAGNOSTIC_PROVIDER=glm the engine runs a two-hop pipeline: Gemini
  // Vision extracts a structured description of the graph, then GLM performs
  // the deep multi-step reasoning over it. GLM models are reasoning models
  // (they emit a separate reasoning_content), so max_tokens must be generous.
  glmApiKey: process.env.GLM_API_KEY || '',
  glmModel: process.env.GLM_MODEL || 'glm-4.6',
  glmBaseUrl: (process.env.GLM_BASE_URL || 'https://api.z.ai/api/coding/paas/v4').replace(/\/+$/, ''),
  glmMaxTokens: toInt(process.env.GLM_MAX_TOKENS, 16000),

  // Which provider powers Tier-2 diagnostics: gemini | glm
  diagnosticProvider: (process.env.DIAGNOSTIC_PROVIDER || 'glm').toLowerCase(),

  // ── Vision provider (Tier-1 verification + Tier-2 image extraction) ───
  //   gemini  — Gemini Vision (needs GEMINI_API_KEY)
  //   glm-mcp — GLM-4.6V via z.ai MCP server (needs only GLM_API_KEY) ← GEMINI-FREE
  //   groq    — Groq vision model qwen3.6-27b (needs GROQ_API_KEY, free)
  visionProvider: (process.env.VISION_PROVIDER || 'gemini').toLowerCase(),

  // ── MCP + Groq config ───────────────────────────────────────────────
  mcpTimeoutMs: toInt(process.env.MCP_TIMEOUT_MS, 180000),
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'qwen/qwen3.6-27b',
  groqBaseUrl: (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),

  // ── Image processing limits ─────────────────────────────────────────
  maxImageWidth: toInt(process.env.MAX_IMAGE_WIDTH, 1600),
  maxUploadBytes: toInt(process.env.MAX_UPLOAD_BYTES, 15 * 1024 * 1024),

  // ── Upstream model request timeout (ms) ─────────────────────────────
  requestTimeoutMs: toInt(process.env.REQUEST_TIMEOUT_MS, 120000),
};

/**
 * Validate the minimum config needed to boot.
 *
 * Tier-1 verification ALWAYS uses Gemini Vision (per spec), so a Gemini key
 * is mandatory regardless of the Tier-2 provider choice. If the Tier-2
 * provider is GLM, a GLM key is also required.
 */
export function assertServerConfig() {
  const missing = [];

  // Vision provider key requirements
  if (config.visionProvider === 'gemini' && !config.geminiApiKey) {
    missing.push('GEMINI_API_KEY (required when VISION_PROVIDER=gemini)');
  }
  if (config.visionProvider === 'glm-mcp' && !config.glmApiKey) {
    missing.push('GLM_API_KEY (required when VISION_PROVIDER=glm-mcp)');
  }
  if (config.visionProvider === 'groq' && !config.groqApiKey) {
    missing.push('GROQ_API_KEY (required when VISION_PROVIDER=groq)');
  }

  // Diagnostic (reasoning) provider key requirements
  if (config.diagnosticProvider === 'gemini' && !config.geminiApiKey) {
    missing.push('GEMINI_API_KEY (required when DIAGNOSTIC_PROVIDER=gemini)');
  }
  if (config.diagnosticProvider === 'glm' && !config.glmApiKey) {
    missing.push('GLM_API_KEY (required when DIAGNOSTIC_PROVIDER=glm)');
  }

  if (missing.length) {
    throw new Error(
      'Missing required environment variables in server/.env:\n  - ' + missing.join('\n  - ')
    );
  }
}

