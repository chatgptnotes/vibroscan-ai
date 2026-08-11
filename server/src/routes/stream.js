import { Router } from 'express';
import { upload } from '../middleware/upload.js';
import { processImage } from '../utils/image.js';
import { verifyVibrationGraph } from '../services/verification.js';
import { runDiagnosticsStream } from '../services/diagnostics.js';
import { config } from '../config.js';
import { VerificationServiceError, DiagnosticServiceError } from '../errors.js';

export const streamRouter = Router();

function sse(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * POST /api/analyze-stream  (multipart/form-data: image, description)
 *
 * Server-Sent Events stream:
 *   stage    { stage: 'verifying' | 'diagnosing' }
 *   verified { reason }
 *   rejected { verified:false, reason }   -> abort (Tier 1 failed)
 *   chunk    { text }                     -> diagnostic Markdown delta
 *   done     { provider, model }
 *   error    { message, serviceError }    -> abort
 */
streamRouter.post('/analyze-stream', upload.single('image'), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering (nginx/Render)
  res.flushHeaders?.();

  let clientGone = false;
  // res 'close' fires when the client disconnects mid-stream (the socket closes).
  // NOTE: do NOT use req 'close' — for a POST upload it fires as soon as the
  // request body is consumed, which would falsely abort the response.
  res.on('close', () => {
    clientGone = true;
  });

  const end = () => {
    if (!res.writableEnded) {
      try {
        res.end();
      } catch {
        /* noop */
      }
    }
  };

  try {
    if (!req.file) {
      sse(res, 'error', { message: 'No image uploaded.' });
      return end();
    }

    const userDescription = (req.body?.description ?? '').toString().trim();
    const processed = await processImage(req.file.buffer);

    // ── Tier 1 — verification ──────────────────────────────────────────
    sse(res, 'stage', { stage: 'verifying' });
    let verification;
    try {
      verification = await verifyVibrationGraph({
        base64: processed.base64,
        buffer: processed.buffer,
        mimeType: processed.mimeType,
      });
    } catch (err) {
      sse(res, 'error', {
        message: err.publicMessage || err.message,
        serviceError: err instanceof VerificationServiceError,
      });
      return end();
    }

    if (!verification.is_legitimate) {
      sse(res, 'rejected', {
        verified: false,
        reason: verification.reason || 'Unrelated or non-diagnostic content detected.',
      });
      return end();
    }

    sse(res, 'verified', { reason: verification.reason });

    // ── Tier 2 — streaming diagnostics ─────────────────────────────────
    sse(res, 'stage', { stage: 'diagnosing' });

    for await (const chunk of runDiagnosticsStream({
      base64: processed.base64,
      mimeType: processed.mimeType,
      buffer: processed.buffer,
      userDescription,
    })) {
      if (clientGone || res.writableEnded) break;
      sse(res, 'chunk', { text: chunk });
    }

    if (!clientGone) {
      sse(res, 'done', {
        provider: config.diagnosticProvider,
        model: config.diagnosticProvider === 'glm' ? config.glmModel : config.geminiDiagnosticModel,
      });
    }
    end();
  } catch (err) {
    sse(res, 'error', {
      message: err.publicMessage || err.message,
      detail: process.env.NODE_ENV === 'production' ? undefined : err.message,
      serviceError: err instanceof DiagnosticServiceError || err instanceof VerificationServiceError,
    });
    end();
  }
});
