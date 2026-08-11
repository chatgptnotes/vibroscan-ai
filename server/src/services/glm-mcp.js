import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { config } from '../config.js';
import { VerificationServiceError, DiagnosticServiceError } from '../errors.js';

let _client = null;
let _initPromise = null;
let _tmpDir = null;

function tmpDir() {
  if (!_tmpDir) _tmpDir = mkdtempSync(join(tmpdir(), 'vc-mcp-'));
  return _tmpDir;
}

/**
 * Lazily spawn the @z_ai/mcp-server child process and connect via stdio MCP.
 * The client is persisted for the lifetime of the server (spawn cost ~1-2s).
 */
async function getClient() {
  if (_client) return _client;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    if (!config.glmApiKey) {
      throw new DiagnosticServiceError('GLM_API_KEY is not configured for GLM MCP vision.');
    }

    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', '@z_ai/mcp-server@latest'],
      env: {
        ...process.env,
        Z_AI_API_KEY: config.glmApiKey,
        Z_AI_MODE: 'ZAI',
      },
      timeout: config.mcpTimeoutMs,
    });

    const client = new Client(
      { name: 'vibrationcheck-server', version: '1.0' },
      { capabilities: {}, timeout: config.mcpTimeoutMs },
    );
    await client.connect(transport);
    _client = client;
    return client;
  })();

  try {
    return await _initPromise;
  } catch (err) {
    _initPromise = null;
    throw new DiagnosticServiceError(`MCP vision server failed to start: ${err.message}`, {
      cause: err,
    });
  }
}

/**
 * Write an image buffer to a temp file and return the absolute path.
 * (The MCP tools accept local file paths or URLs, not inline base64.)
 */
function writeTempImage(buffer, ext = '.png') {
  const name = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const p = join(tmpDir(), name);
  writeFileSync(p, buffer);
  return p;
}

function rmTemp(path) {
  try {
    unlinkSync(path);
  } catch {
    /* noop */
  }
}

/**
 * Call the GLM-4.6V `analyze_data_visualization` MCP tool on an image buffer.
 * Returns the text result. Used for both verification and chart extraction.
 */
export async function glmMcpAnalyzeImage(buffer, prompt, opts = {}) {
  const { tool = 'analyze_data_visualization', analysisFocus, guardVerification = false } = opts;
  let imgPath;
  try {
    const client = await getClient();
    imgPath = writeTempImage(buffer);

    const arguments_ = { image_source: imgPath, prompt };
    if (analysisFocus) arguments_.analysis_focus = analysisFocus;

    const result = await client.callTool(
      { name: tool, arguments: arguments_ },
      undefined,
      { timeout: config.mcpTimeoutMs },
    );

    // Extract text from the MCP content array.
    let text = '';
    for (const item of result.content || []) {
      if (item.type === 'text') text += item.text;
    }
    if (!text.trim()) {
      throw (guardVerification ? new VerificationServiceError('GLM-4.6V returned an empty response.') : new DiagnosticServiceError('GLM-4.6V returned an empty response.'));
    }
    return text;
  } catch (err) {
    if (err instanceof VerificationServiceError || err instanceof DiagnosticServiceError) throw err;
    const ErrClass = guardVerification ? VerificationServiceError : DiagnosticServiceError;
    throw new ErrClass(`GLM MCP vision call failed: ${err.message}`, { cause: err });
  } finally {
    if (imgPath) rmTemp(imgPath);
  }
}

/** Graceful shutdown — close the MCP child process. */
export async function closeMcpVision() {
  if (_client) {
    try {
      await _client.close();
    } catch {
      /* noop */
    }
    _client = null;
    _initPromise = null;
  }
}
