import { Router } from 'express';
import { upload } from '../middleware/upload.js';
import { processImage } from '../utils/image.js';
import { verifyVibrationGraph } from '../services/verification.js';
import { runDiagnostics } from '../services/diagnostics.js';

export const analyzeRouter = Router();

/**
 * POST /api/analyze-vibration
 * multipart/form-data:
 *   - image:       File (required)  — the vibration graph photo/upload
 *   - description: string (optional) — operator notes
 *
 * Two-tier pipeline:
 *   Tier 1 — Legitimacy verification (guardrail). Aborts with 400 if not a graph.
 *   Tier 2 — Diagnostic reasoning against the B&K Vibro Diagnostic Chart.
 */
analyzeRouter.post('/analyze-vibration', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image uploaded. Attach an image under the field name "image".',
      });
    }

    const userDescription = (req.body?.description ?? '').toString().trim();

    // Normalise + compress server-side.
    const processed = await processImage(req.file.buffer);

    // ── Tier 1 — Legitimacy Verification (guardrail) ──────────────────
    const verification = await verifyVibrationGraph({
      base64: processed.base64,
      buffer: processed.buffer,
      mimeType: processed.mimeType,
    });

    if (!verification.is_legitimate) {
      return res.status(400).json({
        success: false,
        verified: false,
        error: 'The submitted image could not be verified as a legitimate industrial vibration graph.',
        reason: verification.reason || 'Unrelated or non-diagnostic content detected.',
      });
    }

    // ── Tier 2 — Diagnostic Reasoning Engine ──────────────────────────
    const diagnosis = await runDiagnostics({
      base64: processed.base64,
      mimeType: processed.mimeType,
      buffer: processed.buffer,
      userDescription,
    });

    return res.status(200).json({
      success: true,
      verified: true,
      reason: verification.reason,
      report: diagnosis.report,
      provider: diagnosis.provider,
      model: diagnosis.model,
    });
  } catch (err) {
    next(err);
  }
});
