// ─────────────────────────────────────────────────────────────────────
// Tier 2 (deterministic path) — Structured feature EXTRACTION prompt.
//
// Unlike the LLM-diagnostic prompt, this asks the vision model to describe
// ONLY what is literally on the chart as strict JSON (no diagnosis, no
// interpretation). The numbers returned here feed the deterministic
// ruleEngine.js, so the diagnosis itself is 100% reproducible code.
// ─────────────────────────────────────────────────────────────────────

export const EXTRACTION_PROMPT = `You are a precision vision system. Examine this vibration graph and extract ONLY literal, factual features as JSON. Do NOT diagnose, interpret, or infer fault types — just read the chart. Respond ONLY in valid JSON with exactly this schema:

{
  "chartType": "FFT Spectrum | Time Waveform | Orbit | Bode/Polar | Cascade/Waterfall | Envelope | Cepstrum | ASC | Unknown",
  "axisX": { "quantity": "string", "unit": "string", "min": number, "max": number },
  "axisY": { "quantity": "string", "unit": "string", "min": number, "max": number },
  "peaks": [
    { "freq": number, "amplitude": number, "note": "literal annotation text, e.g. 1X / 2X / Resonance / 3X; empty string if none" }
  ],
  "resonances": [number],
  "overallRMS": number | null,
  "lineFrequencyHz": number | null,
  "notes": "any other literal visible labels"
}

Rules for reading:
- freq  = the frequency on the X-axis where a peak sits (Hz). If axis is in orders (X), put the order value and set axisX.unit to "orders".
- amplitude = the Y-axis value of each peak (in the axisY.unit). Estimate from gridlines.
- List EVERY discrete peak you can see, largest first. Include annotated harmonics.
- resonances = frequencies the chart explicitly labels as resonance / natural frequency.
- lineFrequencyHz = the mains supply frequency only if it is stated or clearly implied (50 or 60); otherwise null.
- If a field cannot be read, use null (for scalars) or [] (for arrays). Never invent numbers.`;

/**
 * Optional: parse/operator-notes side-channel. Currently the extractor ignores
 * operator notes (the rule engine consumes structured numbers only), but we
 * expose a hook so future rules can use RPM / bearing geometry from notes.
 */
export function buildExtractionContext(userDescription) {
  return (userDescription && userDescription.trim()) || 'No additional operator notes provided.';
}
