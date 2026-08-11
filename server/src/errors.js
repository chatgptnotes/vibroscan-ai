// Typed errors so the route layer can map them to the correct HTTP status.

/**
 * Thrown when the verification *service itself* misbehaves (network error,
 * auth error, empty/unparseable model output). This is NOT the same as the
 * model deciding an image is not a graph — that is a normal `is_legitimate:false`
 * verdict handled as HTTP 400. A service failure should surface as 502 so the
 * client can prompt "service unavailable, please retry" instead of a misleading
 * "image not recognized".
 */
export class VerificationServiceError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'VerificationServiceError';
    this.status = 502;
    this.publicMessage =
      'The verification service is temporarily unavailable. Please retry in a moment.';
    if (cause) this.cause = cause;
  }
}

/**
 * Thrown when the diagnostic *service* misbehaves (network/timeout/auth/quota).
 * Maps to HTTP 502. Pass `publicMessage` to override the default user-facing text.
 */
export class DiagnosticServiceError extends Error {
  constructor(message, { cause, publicMessage } = {}) {
    super(message);
    this.name = 'DiagnosticServiceError';
    this.status = 502;
    this.publicMessage =
      publicMessage ||
      'The diagnostic reasoning service is temporarily unavailable. Please retry.';
    if (cause) this.cause = cause;
  }
}
