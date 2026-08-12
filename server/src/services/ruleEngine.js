// ─────────────────────────────────────────────────────────────────────
// Deterministic Diagnostic Rule Engine
//
// Consumes a structured feature extraction (see prompts/extraction.js) and
// evaluates the Brüel & Kjær (BKV) Vibro Diagnostic Chart rule base as PURE,
// REPRODUCIBLE code. No LLM in this stage: same input → same output, always.
//
// Each rule emits a confidence tier:
//   STRONG            — rule signature clearly present
//   POSSIBLE          — partial / weak match
//   INSUFFICIENT_DATA — rule needs data this chart cannot provide (phase, geometry, trend)
//   NO                — rule signature absent (negative finding)
//   N/A               — rule out of scope for this chart type/range
// ─────────────────────────────────────────────────────────────────────

// ---- Tunable thresholds (deterministic; tweak here, affects all runs) ----
const DOMINANT_FRACTION = 0.6; // peak > 60% of Y-axis max => "dominant 1X" candidate
const HARMONIC_TOL = 0.02; // ±2% of target to count as an integer harmonic
const MIN_HARMONICS_LOOSENESS = 3; // 1X+2X+3X minimum train for looseness
const STRONG_HARMONICS_LOOSENESS = 4; // 4+ harmonics => STRONG looseness
const HARMONIC2X_RATIO = 0.3; // 2X/1X amplitude ratio above which misalignment is POSSIBLE
const BEATING_DELTA_HZ = 5; // peaks within 5 Hz with both notable amplitude => beating candidate
const BEATING_MIN_AMP_FRAC = 0.1; // beating candidate min amplitude as fraction of dominant
const ISO_ZONE_D_RMS = 7.1; // mm/s RMS, ISO 10816-3 Class II C/D boundary (state assumption)
const ISO_ZONE_C_RMS = 4.5;
const ISO_ZONE_B_RMS = 2.8;
const G_TO_MS2 = 9.80665;

const CONFIDENCE_ORDER = { STRONG: 0, POSSIBLE: 1, 'INSUFFICIENT_DATA': 2, NO: 3, 'N/A': 4 };

/**
 * Evaluate all rules against an extraction. Returns { findings, severity }.
 */
export function evaluateRules(ext) {
  const peaks = normalizePeaks(ext);
  const findings = [
    ruleImbalance(peaks, ext),
    ruleMisalignment(peaks, ext),
    ruleBearings(peaks, ext),
    ruleGearbox(peaks, ext),
    ruleLooseness(peaks, ext),
    ruleResonance(peaks, ext),
    ruleBeating(peaks, ext),
    ruleCrackedShaft(peaks, ext),
    ruleElectrical(peaks, ext),
    ruleHydraulic(peaks, ext),
  ];
  const severity = computeSeverity(peaks, ext);
  return { findings, severity };
}

// ---------- helpers ----------

function normalizePeaks(ext) {
  if (!Array.isArray(ext?.peaks)) return [];
  return ext.peaks
    .map((p) => ({
      freq: Number(p?.freq),
      amplitude: Number(p?.amplitude),
      note: String(p?.note || ''),
    }))
    .filter((p) => Number.isFinite(p.freq) && p.freq >= 0 && Number.isFinite(p.amplitude))
    .sort((a, b) => b.amplitude - a.amplitude);
}

function yAxisMax(ext) {
  const m = Number(ext?.axisY?.max);
  return Number.isFinite(m) && m > 0 ? m : null;
}

function findHarmonics(fundamental, peaks) {
  const out = {};
  for (let n = 1; n <= 6; n++) {
    const target = fundamental * n;
    const tol = Math.max(HARMONIC_TOL * target, 0.5); // at least 0.5 Hz tolerance
    const hit = peaks.find((p) => Math.abs(p.freq - target) <= tol);
    if (hit) out[n] = hit;
  }
  return out;
}

function fundLabel(f) {
  return f != null ? f.toFixed(2) : '—';
}

function hasHighFrequencyRange(ext) {
  const maxX = Number(ext?.axisX?.max);
  return Number.isFinite(maxX) && maxX >= 1000; // need to reach kHz band
}

function hasBroadbandNoise(peaks, ext) {
  const yMax = yAxisMax(ext);
  if (!yMax || !peaks.length) return false;
  const hf = peaks.filter((p) => p.freq >= 1000);
  const lowAmp = hf.filter((p) => p.amplitude / yMax < 0.15);
  return lowAmp.length >= 8;
}

function inferLineFrequency(peaks) {
  const near = (f, t) => peaks.some((p) => Math.abs(p.freq - f) <= t);
  if (near(100, 2)) return 50;
  if (near(120, 2)) return 60;
  return null;
}

export { fundLabel, CONFIDENCE_ORDER };

// ---------- rules ----------

function ruleImbalance(peaks, ext) {
  const name = 'Imbalance (R1)';
  const yMax = yAxisMax(ext);
  if (!peaks.length) {
    return { name, fired: false, confidence: 'INSUFFICIENT_DATA', evidence: 'No peaks detected.', missingData: [] };
  }
  const dom = peaks[0];
  const domFrac = yMax ? dom.amplitude / yMax : 0.7;
  const fired = domFrac >= DOMINANT_FRACTION;
  return {
    name,
    fired,
    confidence: fired ? 'STRONG' : 'NO',
    evidence: fired
      ? `Dominant peak at ${dom.freq} Hz (${dom.amplitude} ${ext?.axisY?.unit || ''}) = ${(domFrac * 100).toFixed(0)}% of Y-axis max → qualifies as dominant 1X.`
      : `Dominant peak is only ${(domFrac * 100).toFixed(0)}% of Y-axis max (< ${DOMINANT_FRACTION * 100}%); imbalance not indicated.`,
    missingData: fired ? ['cross-bearing phase (to type: static/couple/dynamic/overhung)'] : [],
  };
}

function ruleMisalignment(peaks, ext) {
  const name = 'Misalignment (R2)';
  if (peaks.length < 2) {
    return { name, fired: false, confidence: 'INSUFFICIENT_DATA', evidence: 'Need 1X and 2X peaks.', missingData: [] };
  }
  const dom = peaks[0];
  const target2X = dom.freq * 2;
  const tol = Math.max(HARMONIC_TOL * target2X, 0.5);
  const twoX = peaks.find((p) => Math.abs(p.freq - target2X) <= tol);
  const ratio = twoX ? twoX.amplitude / dom.amplitude : 0;
  const fired = twoX && ratio >= HARMONIC2X_RATIO;
  return {
    name,
    fired: !!fired,
    confidence: fired ? 'POSSIBLE' : 'NO',
    evidence: fired
      ? `2X present at ${twoX.freq} Hz (${twoX.amplitude}); 2X/1X ratio = ${ratio.toFixed(2)} (≥ ${HARMONIC2X_RATIO}).`
      : (twoX ? `2X present but 2X/1X ratio = ${ratio.toFixed(2)} (< ${HARMONIC2X_RATIO}).` : `No 2X peak near ${target2X.toFixed(1)} Hz.`),
    missingData: fired ? ['axial spectrum + 180° phase across coupling (to type: parallel/angular/cocked/bent)'] : [],
  };
}

function ruleBearings(peaks, ext) {
  const name = 'Rolling Element Bearings (R3)';
  if (!hasHighFrequencyRange(ext)) {
    return { name, fired: false, confidence: 'N/A', evidence: 'Axis range does not reach the high-frequency bearing band.', missingData: [] };
  }
  if (hasBroadbandNoise(peaks, ext)) {
    return { name, fired: true, confidence: 'STRONG', evidence: 'Broadband HF noise-floor rise detected → late-stage bearing damage signature.', missingData: ['bearing geometry (#balls) to identify BPFO/BPFI', 'envelope/demodulation spectrum'] };
  }
  return {
    name,
    fired: false,
    confidence: 'INSUFFICIENT_DATA',
    evidence: 'No broadband HF rise; discrete peaks only. Early-stage REB wear cannot be ruled out without envelope analysis.',
    missingData: ['bearing geometry (#balls) → BPFO≈0.4×#balls×RPM, BPFI≈0.6×#balls×RPM', 'envelope/demodulation spectrum'],
  };
}

function ruleGearbox(_peaks, _ext) {
  const name = 'Gearbox (R4)';
  return {
    name,
    fired: false,
    confidence: 'INSUFFICIENT_DATA',
    evidence: 'TMF/GAPF cannot be computed without gear tooth count and RPM. No annotated TMF present.',
    missingData: ['#teeth → TMF=#teeth×RPM', 'RPM', 'cepstrum quefrency data'],
  };
}

function ruleLooseness(peaks, ext) {
  const name = 'Mechanical Looseness (R5a)';
  if (!peaks.length) {
    return { name, fired: false, confidence: 'INSUFFICIENT_DATA', evidence: 'No peaks.', missingData: [] };
  }
  let best = { count: 0, fundamental: null };
  for (const cand of peaks.slice(0, 3)) {
    if (cand.freq <= 0) continue;
    const harm = findHarmonics(cand.freq, peaks);
    const count = Object.keys(harm).length;
    if (count > best.count) best = { count, fundamental: cand.freq };
  }
  const subSync = peaks.find((p) => p.freq > 0 && best.fundamental && p.freq < best.fundamental && (p.freq / best.fundamental) < 0.75);
  if (best.count >= MIN_HARMONICS_LOOSENESS) {
    return {
      name,
      fired: true,
      confidence: best.count >= STRONG_HARMONICS_LOOSENESS ? 'STRONG' : 'POSSIBLE',
      evidence: `${best.count} integer harmonics anchored at ${fundLabel(best.fundamental)} Hz (1X→${best.count}X).${subSync ? ' Sub-synchronous content present → severe looseness grade.' : ''}`,
      missingData: [],
    };
  }
  return {
    name,
    fired: false,
    confidence: 'NO',
    evidence: best.count >= 2 ? `Only ${best.count} harmonics at ${fundLabel(best.fundamental)} Hz (< ${MIN_HARMONICS_LOOSENESS} needed).` : 'No integer harmonic train detected.',
    missingData: [],
  };
}

function ruleResonance(peaks, ext) {
  const name = 'Resonance Amplification (R5b)';
  const resonances = Array.isArray(ext?.resonances) ? ext.resonances.filter((r) => Number.isFinite(r)) : [];
  const noteRes = peaks.filter((p) => /resonan/i.test(p.note)).map((p) => p.freq);
  const allRes = Array.from(new Set([...resonances, ...noteRes]));
  if (!allRes.length) {
    return {
      name,
      fired: false,
      confidence: 'INSUFFICIENT_DATA',
      evidence: 'No resonance annotation. Resonance cannot be confirmed from an FFT alone.',
      missingData: ['Bode/Polar plot (90° phase shift + amplitude peak at that speed)'],
    };
  }
  let coincident = null;
  for (const r of allRes) {
    for (const cand of peaks.slice(0, 3)) {
      if (cand.freq <= 0) continue;
      for (let n = 2; n <= 6; n++) {
        if (Math.abs(cand.freq * n - r) <= Math.max(HARMONIC_TOL * r, 0.5)) {
          coincident = { resonance: r, fundamental: cand.freq, harmonic: n };
          break;
        }
      }
      if (coincident) break;
    }
    if (coincident) break;
  }
  return {
    name,
    fired: true,
    confidence: coincident ? 'STRONG' : 'POSSIBLE',
    evidence: coincident
      ? `Resonance at ${coincident.resonance} Hz coincides with ${coincident.harmonic}×${coincident.fundamental.toFixed(2)} Hz → harmonic amplification.`
      : `Resonance annotated at ${allRes.join(', ')} Hz (no harmonic coincidence computed).`,
    missingData: ['Bode/Polar phase confirmation'],
  };
}

function ruleBeating(peaks, ext) {
  const name = 'Beating (R5c)';
  if (peaks.length < 2) {
    return { name, fired: false, confidence: 'NO', evidence: 'Fewer than 2 peaks.', missingData: [] };
  }
  const dom = peaks[0];
  const threshold = BEATING_MIN_AMP_FRAC * dom.amplitude;
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < peaks.length; j++) {
      const a = peaks[i];
      const b = peaks[j];
      if (a.amplitude < threshold || b.amplitude < threshold) continue;
      const delta = Math.abs(a.freq - b.freq);
      if (delta > 0 && delta <= BEATING_DELTA_HZ) {
        return {
          name,
          fired: true,
          confidence: 'POSSIBLE',
          evidence: `Two notable peaks at ${a.freq} Hz and ${b.freq} Hz (Δf = ${delta.toFixed(2)} Hz ≤ ${BEATING_DELTA_HZ}) → beating candidate at ${delta.toFixed(2)} Hz.`,
          missingData: [],
        };
      }
    }
  }
  return { name, fired: false, confidence: 'NO', evidence: `No closely-spaced notable peak pairs (≤ ${BEATING_DELTA_HZ} Hz).`, missingData: [] };
}

function ruleCrackedShaft(_peaks, _ext) {
  const name = 'Cracked Shaft (R5d)';
  return {
    name,
    fired: false,
    confidence: 'INSUFFICIENT_DATA',
    evidence: 'Cracked shaft requires 2X/3X growth across run-up/coast-down or repeated surveys. A single static FFT cannot assess it.',
    missingData: ['trend / speed-sweep data (1X with growing 2X/3X, amplitude & phase change with speed/load/warm-up)'],
  };
}

function ruleElectrical(peaks, ext) {
  const name = 'Electrical (R6)';
  const lf = Number(ext?.lineFrequencyHz);
  const supply = lf || inferLineFrequency(peaks);
  if (!supply) {
    return { name, fired: false, confidence: 'INSUFFICIENT_DATA', evidence: 'Supply line frequency unknown; cannot locate 2×LF peak.', missingData: ['line frequency (50/60 Hz)'] };
  }
  const target2LF = supply * 2;
  const tol = Math.max(HARMONIC_TOL * target2LF, 1);
  const hit2LF = peaks.find((p) => Math.abs(p.freq - target2LF) <= tol);
  if (hit2LF) {
    return { name, fired: true, confidence: 'STRONG', evidence: `Peak at ${hit2LF.freq} Hz matches 2×LF (${target2LF} Hz, supply ${supply} Hz).`, missingData: ['pole-pass frequency (PPF = 2×LF×slip) sidebands around 1X to confirm broken rotor bar'] };
  }
  return { name, fired: false, confidence: 'NO', evidence: `No peak near 2×LF (${target2LF} Hz).`, missingData: [] };
}

function ruleHydraulic(peaks, ext) {
  const name = 'Hydraulic — Cavitation / Flow (R7)';
  if (!hasHighFrequencyRange(ext)) {
    return { name, fired: false, confidence: 'N/A', evidence: 'Axis range (≤ ~1 kHz) cannot reveal cavitation (broadband HF 1 kHz–50 kHz).', missingData: [] };
  }
  const broadband = hasBroadbandNoise(peaks, ext);
  return {
    name,
    fired: broadband,
    confidence: broadband ? 'POSSIBLE' : 'NO',
    evidence: broadband ? 'Broadband HF energy detected → possible cavitation / flow turbulence.' : 'No broadband HF energy in the plotted range.',
    missingData: broadband ? ['suction flow/pressure correlation'] : [],
  };
}

// ---------- renderer: deterministic findings → Markdown report ----------

const CONFIDENCE_BADGE = {
  STRONG: '🔴 STRONG',
  POSSIBLE: '🟡 POSSIBLE',
  INSUFFICIENT_DATA: '⚪ INSUFFICIENT DATA',
  NO: '🟢 NOT INDICATED',
  'N/A': '➖ N/A (out of range)',
};

export function renderDeterministicReport(ext, evalResult) {
  const chartType = ext?.chartType || 'Unknown';
  const ax = ext?.axisX || {};
  const ay = ext?.axisY || {};
  const peaks = Array.isArray(ext?.peaks) ? ext.peaks : [];
  const sorted = [...peaks]
    .map((p) => ({ freq: Number(p.freq), amplitude: Number(p.amplitude), note: String(p.note || '') }))
    .filter((p) => Number.isFinite(p.freq) && Number.isFinite(p.amplitude))
    .sort((a, b) => b.amplitude - a.amplitude);

  // For an FFT-synthesized spectrum, frequencies are in Hz (not the original
  // time axis unit), and peaks come from DSP rather than vision extraction.
  const synthFrom = ext?.synthFrom === 'fft';
  const freqUnit = synthFrom ? 'Hz' : (ax.unit || 'Hz');
  const findingsLabel = synthFrom
    ? 'Key Spectral Findings (FFT-synthesized from time waveform, ranked by amplitude)'
    : 'Key Spectral Findings (vision-extracted, ranked by amplitude)';

  // ── Graph Classification ──
  const lines = [];
  lines.push('### Graph Classification');
  lines.push(`- **Chart type:** ${chartType}`);
  lines.push(`- **X-axis:** ${ax.quantity || 'Frequency'} (${ax.unit || '—'}) range ${fmtNum(ax.min)}–${fmtNum(ax.max)}`);
  lines.push(`- **Y-axis:** ${ay.quantity || 'Amplitude'} (${ay.unit || '—'}) range ${fmtNum(ay.min)}–${fmtNum(ay.max)}`);
  if (synthFrom && ext?._fftMeta) {
    lines.push(`- **FFT synthesis:** ${ext._fftMeta.samples} samples @ ${ext._fftMeta.sampleRateHz} Hz sample rate (Nyquist ${ext._fftMeta.nyquistHz} Hz)`);
  }
  lines.push('');
  lines.push('> Deterministic engine — features were read by vision (Stage 1) and evaluated against the B&K rule base by fixed code (Stage 2). Same input always yields this output.');
  lines.push('');

  // ── Key Spectral Findings ──
  lines.push(`### ${findingsLabel}`);
  if (!sorted.length) {
    lines.push('- No discrete peaks extracted.');
  } else {
    sorted.slice(0, 10).forEach((p, i) => {
      const note = p.note ? ` — *${p.note}*` : '';
      lines.push(`${i + 1}. **${fmtNum(p.freq)} ${freqUnit}** @ **${fmtNum(p.amplitude)}**${note}`);
    });
  }
  const res = Array.isArray(ext?.resonances) ? ext.resonances.filter(Number.isFinite) : [];
  if (res.length) lines.push(`\n- **Annotated resonances:** ${res.map((r) => fmtNum(r) + ' Hz').join(', ')}`);
  lines.push('');

  // ── Diagnostic Findings (rules table) ──
  lines.push('### Diagnostic Findings & Fault Identification (deterministic rules)');
  const sortedFindings = [...evalResult.findings].sort(
    (a, b) => (CONFIDENCE_ORDER[a.confidence] ?? 9) - (CONFIDENCE_ORDER[b.confidence] ?? 9)
  );
  lines.push('');
  lines.push('| # | Rule | Verdict | Evidence |');
  lines.push('|---|------|---------|----------|');
  sortedFindings.forEach((f, i) => {
    const ev = (f.evidence || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(`| ${i + 1} | ${f.name} | ${CONFIDENCE_BADGE[f.confidence] || f.confidence} | ${ev} |`);
  });
  lines.push('');
  // detail: missing data per fired/insufficient rule
  const needData = sortedFindings.filter((f) => f.missingData && f.missingData.length);
  if (needData.length) {
    lines.push('**Data still required to close gaps:**');
    needData.forEach((f) => {
      lines.push(`- *${f.name}*: ${f.missingData.join('; ')}`);
    });
    lines.push('');
  }

  // ── Severity & Recommendations ──
  lines.push('### Severity & Actionable Recommendations');
  const sev = evalResult.severity;
  if (sev.computed) {
    lines.push(`- **Severity band:** ${sev.band}`);
    lines.push(`  - Dominant peak ${fmtNum(sev.dominantFreqHz)} Hz @ ${fmtNum(sev.dominantAmp)} ${sev.unit} → v_peak ≈ ${sev.vPeakMmS} mm/s, **v_rms ≈ ${sev.vRmsMmS} mm/s**`);
    lines.push(`  - ${sev.basis}`);
  } else {
    lines.push(`- **Severity band:** not computed — ${sev.reason || 'insufficient data'}`);
  }
  lines.push('');
  lines.push('**Actionable next steps (derived from fired rules):**');
  const actions = recommendationsFor(evalResult.findings);
  if (!actions.length) lines.push('- No fault signatures fired; continue routine monitoring.');
  else actions.forEach((a, i) => lines.push(`${i + 1}. ${a}`));

  return lines.join('\n');
}

function recommendationsFor(findings) {
  const map = Object.fromEntries(findings.map((f) => [f.name, f]));
  const out = [];
  if (map['Imbalance (R1)']?.fired) out.push('**Imbalance (R1):** perform single/two-plane field balancing of the rotor at the dominant 1X speed. Capture cross-bearing phase to type it (static/couple/dynamic/overhung).');
  if (map['Misalignment (R2)']?.fired) out.push('**Misalignment (R2):** laser-align the coupling; collect axial + 180° phase data to type it (parallel/angular/cocked/bent).');
  if (map['Mechanical Looseness (R5a)']?.fired) out.push('**Looseness (R5a):** torque/inspect hold-down bolts, bearing fits, soleplates, and pedestal mounts; check for soft foot.');
  if (map['Resonance Amplification (R5b)']?.fired) out.push('**Resonance (R5b):** run a shutdown bump/impact test to confirm the natural frequency; add stiffening or a detuner to shift it away from operating harmonics.');
  if (map['Beating (R5c)']?.fired) out.push('**Beating (R5c):** identify the two close forcing frequencies and isolate/damp one (often a nearby resonance or a second running speed).');
  if (map['Rolling Element Bearings (R3)']?.confidence === 'STRONG') out.push('**Bearings (R3):** schedule bearing replacement; confirm defect frequencies via envelope/demodulation and bearing geometry (#balls).');
  if (map['Electrical (R6)']?.fired) out.push('**Electrical (R6):** perform motor current / eccentricity analysis; check for broken rotor bars via PPF sidebands.');
  if (map['Hydraulic — Cavitation / Flow (R7)']?.fired) out.push('**Hydraulic (R7):** check suction pressure/NPSH; correlate vibration with flow rate.');
  return out;
}

function fmtNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
}

// ---------- severity ----------

function computeSeverity(peaks, ext) {
  if (!peaks.length) return { computed: false, reason: 'No peaks to score.' };
  const dom = peaks[0];
  const unit = String(ext?.axisY?.unit || '').toLowerCase();
  let aMS2;
  if (unit === 'g') aMS2 = dom.amplitude * G_TO_MS2;
  else if (unit === 'm/s²' || unit === 'm/s2') aMS2 = dom.amplitude;
  else return { computed: false, reason: `Y-axis unit "${unit}" is not acceleration; velocity severity not computed.` };

  const vPeakMmS = (aMS2 / (2 * Math.PI * dom.freq)) * 1000;
  const vRmsMmS = vPeakMmS / Math.SQRT2;
  let band = 'A (Good)';
  if (vRmsMmS > ISO_ZONE_D_RMS) band = 'D (Unacceptable / CRITICAL)';
  else if (vRmsMmS > ISO_ZONE_C_RMS) band = 'C (Unsatisfactory)';
  else if (vRmsMmS > ISO_ZONE_B_RMS) band = 'B (Acceptable)';
  return {
    computed: true,
    dominantFreqHz: dom.freq,
    dominantAmp: dom.amplitude,
    unit,
    vPeakMmS: Number(vPeakMmS.toFixed(1)),
    vRmsMmS: Number(vRmsMmS.toFixed(1)),
    band,
    basis: `v_peak = a/(2πf) from the dominant peak, then v_rms = v_peak/√2. ISO 10816-3 Class II band assumption (C/D boundary ${ISO_ZONE_D_RMS} mm/s RMS).`,
  };
}
