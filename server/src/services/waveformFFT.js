// ─────────────────────────────────────────────────────────────────────
// Waveform → Spectrum (FFT) preprocessing for the deterministic engine.
//
// A Time Waveform chart (amplitude vs time) contains NO frequency peaks,
// so the frequency-domain B&K rules can't fire. This module extracts the
// plotted trace from the image pixels, samples it, applies a Hann window,
// runs a radix-2 Cooley-Tukey FFT, and returns discrete {freqHz, amplitude}
// peaks — which then feed the EXISTING ruleEngine unchanged.
//
// Pure JS, no external dependency (FFT inlined below).
// ─────────────────────────────────────────────────────────────────────
import sharp from 'sharp';

// ---------- trace segmentation ----------

/**
 * Decide whether a chart is dark-themed (trace on black) or light-themed.
 * Sample the corner pixels; if average brightness < 128 => dark theme.
 */
async function detectTheme(buffer) {
  const { data, info } = await sharp(buffer)
    .resize({ width: 64, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0, n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    n++;
  }
  return sum / n < 128 ? 'dark' : 'light';
}

/**
 * Is a pixel part of the trace line?
 * Trace pixels are highly saturated (one channel dominates) — unlike gridlines
 * (gray, R≈G≈B) or background (black/white).
 */
function isTracePixel(r, g, b, theme) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max; // 0 (gray) .. 1 (pure hue)
  const brightEnough = theme === 'dark' ? max > 90 : max > 60 && min < 200;
  return sat > 0.45 && brightEnough;
}

/**
 * For each image column x, find the trace's y (row). Returns a Float32Array of
 * length = image width, where each entry is the y-pixel of the trace (or NaN if
 * no trace pixel in that column — e.g. margins). Multi-pixel-thick traces are
 * averaged (centroid) to a single y per column.
 */
export async function extractTrace(buffer) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const theme = await detectTheme(buffer);

  const traceY = new Float32Array(w);
  for (let x = 0; x < w; x++) traceY[x] = NaN;

  for (let x = 0; x < w; x++) {
    let sum = 0, count = 0;
    for (let y = 0; y < h; y++) {
      const idx = (y * w + x) * ch;
      if (isTracePixel(data[idx], data[idx + 1], data[idx + 2], theme)) {
        sum += y;
        count++;
      }
    }
    if (count > 0) traceY[x] = sum / count;
  }
  return { traceY, width: w, height: h, theme };
}

// ---------- calibration: pixels → physical units ----------

/**
 * Build a sampled signal (amplitude per time-step) from the trace.
 * Uses the vision-extracted axis ranges (axisX = time, axisY = amplitude).
 *
 * @param traceY Float32Array of y-pixels (NaN where no trace)
 * @param info { width, height }
 * @param axisX { min, max, unit } e.g. time 0..100 ms
 * @param axisY { min, max, unit } e.g. -20..20 um
 * @returns { samples: Float32Array, sampleRateHz: number, dt: seconds }
 */
export function calibrateSignal(traceY, info, axisX, axisY) {
  const { width: w, height: h } = info;
  // physical ranges (default sane values if extraction missed them)
  const tMin = Number(axisX?.min) || 0;
  const tMax = Number(axisX?.max) || 100; // ms default
  const yMin = Number(axisY?.min) || -1;
  const yMax = Number(axisY?.max) || 1;

  const tMaxSec = (tMax - tMin) / 1000; // ms → s
  const yRange = yMax - yMin || 2;
  const yMidPx = h / 2; // screen Y grows downward; midline = 0 amplitude

  const samples = new Float32Array(w);
  let valid = 0;
  for (let x = 0; x < w; x++) {
    const y = traceY[x];
    if (!Number.isFinite(y)) {
      samples[x] = 0; // gap (margin) → fill 0, will be windowed down
    } else {
      // map pixel y → amplitude: midline=0, top=+yMax, bottom=-yMin (image y inverted)
      const frac = (yMidPx - y) / (h / 2); // -1 (bottom) .. +1 (top)
      samples[x] = frac * (yRange / 2);
      valid++;
    }
  }
  if (valid === 0) throw new Error('No trace pixels found across any column.');
  const dt = tMaxSec / (w - 1); // seconds per sample
  const sampleRateHz = 1 / dt;
  return { samples, sampleRateHz, dt };
}

// ---------- radix-2 Cooley-Tukey FFT (inlined, no dependency) ----------

/**
 * Zero-pad to next power of two, apply Hann window, FFT, return magnitude spectrum.
 * Returns Float32Array of length N/2 (one-sided), in amplitude units.
 */
export function computeSpectrum(samples, sampleRateHz) {
  // next power of two >= length
  let n = 1;
  while (n < samples.length) n *= 2;
  const re = new Float32Array(n);
  const im = new Float32Array(n);

  // Hann window + copy into re[]
  for (let i = 0; i < samples.length; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (samples.length - 1)));
    re[i] = samples[i] * w;
  }
  // zero-pad remainder already 0.

  fftInPlace(re, im);

  const half = n >> 1;
  const mag = new Float32Array(half);
  for (let k = 0; k < half; k++) {
    // |X(k)| ; scale by N/2 to approximate amplitude (single-sided)
    mag[k] = (2 * Math.hypot(re[k], im[k])) / n;
  }
  // frequency resolution
  const freqs = new Float32Array(half);
  for (let k = 0; k < half; k++) freqs[k] = (k * sampleRateHz) / n;
  return { magnitude: mag, frequencies: freqs, n, sampleRateHz };
}

/**
 * In-place iterative radix-2 Cooley-Tukey FFT. Length must be a power of two.
 */
function fftInPlace(re, im) {
  const n = re.length;
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  // butterflies
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k;
        const b = a + (len >> 1);
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// ---------- peak detection ----------

/**
 * Find local maxima above a noise-floor threshold.
 * @returns [{ freq, amplitude}]  — `freq` matches ruleEngine's normalizePeaks schema
 */
export function findPeaks(magnitude, frequencies, { minAmplitude = 0, maxFreqHz = Infinity } = {}) {
  // noise floor = median of the spectrum (robust to a few tall peaks)
  const sorted = Float32Array.from(magnitude).sort();
  const median = sorted[sorted.length >> 1] || 0;
  const threshold = Math.max(minAmplitude, median * 4);

  const peaks = [];
  for (let k = 2; k < magnitude.length - 2; k++) {
    const f = frequencies[k];
    if (f > maxFreqHz) break;
    const m = magnitude[k];
    if (m < threshold) continue;
    if (m > magnitude[k - 1] && m > magnitude[k + 1] && m >= magnitude[k - 2] && m >= magnitude[k + 2]) {
      peaks.push({ freq: Number(f.toFixed(2)), amplitude: Number(m.toFixed(4)) });
    }
  }
  peaks.sort((a, b) => b.amplitude - a.amplitude);
  return peaks;
}

// ---------- orchestrator ----------

/**
 * Full pipeline: image buffer + vision-extracted axes → synthetic spectrum
 * → discrete peaks. Mutates/returns an extraction object suitable for the
 * rule engine: { chartType, axisX, axisY, peaks[], synthFrom: 'fft' }.
 *
 * Throws if no trace can be extracted.
 */
export async function synthesizeSpectrumFromWaveform(buffer, extraction) {
  const { traceY, width, height, theme } = await extractTrace(buffer);
  const { samples, sampleRateHz } = calibrateSignal(
    traceY,
    { width, height },
    extraction.axisX,
    extraction.axisY
  );
  const { magnitude, frequencies } = computeSpectrum(samples, sampleRateHz);
  const peaks = findPeaks(magnitude, frequencies, { maxFreqHz: sampleRateHz / 2 });

  // Build a synthetic extraction that looks like an FFT to the rule engine,
  // but keeps the original time-waveform axes for the report header.
  return {
    ...extraction,
    chartType: 'FFT Spectrum (synthesized from Time Waveform via FFT)',
    _originalChartType: extraction.chartType,
    peaks,
    synthFrom: 'fft',
    _fftMeta: {
      samples: samples.length,
      sampleRateHz: Math.round(sampleRateHz),
      nyquistHz: Math.round(sampleRateHz / 2),
      traceTheme: theme,
    },
    _spectrum: { magnitude, frequencies }, // kept so the renderer can draw it
  };
}

// ---------- spectrum visualization (pure SVG, no dependencies) ----------

/**
 * Render the magnitude spectrum as a standalone SVG string (dark-themed to
 * match the app UI). Highlights the detected peaks with vertical markers and
 * 1X/2X/3X labels. Frequency axis is capped for legibility (otherwise the
 * Nyquist can be ~8 kHz and squash all peaks to the left edge).
 */
export function renderSpectrumSVG({ magnitude, frequencies, peaks, axisY, maxFreqHz } = {}) {
  if (!magnitude || !frequencies || !magnitude.length) return null;

  const topPeaks = (peaks || []).slice(0, 10);
  const peakMax = topPeaks.length ? Math.max(...topPeaks.map((p) => p.freq)) : 0;
  const fMax = Math.max(maxFreqHz || 0, peakMax * 1.15, 500);

  const pts = [];
  let magMax = 0;
  for (let k = 0; k < frequencies.length; k++) {
    const f = frequencies[k];
    if (f > fMax) break;
    const m = magnitude[k];
    pts.push({ f, m });
    if (m > magMax) magMax = m;
  }
  if (!pts.length || magMax <= 0) return null;
  const aMax = magMax * 1.15;

  const W = 760, H = 320;
  const padL = 52, padR = 16, padT = 18, padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const xOf = (f) => padL + (f / fMax) * plotW;
  const yOf = (m) => padT + plotH - (m / aMax) * plotH;

  const fTicks = niceTicks(0, fMax, 6);
  const aTicks = niceTicks(0, aMax, 4);
  const ampUnit = axisY?.unit ? ` ${axisY.unit}` : '';

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif">`;
  svg += `<rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="#0f172a"/>`;
  svg += `<text x="${padL}" y="14" fill="#94a3b8" font-size="12" font-weight="600">Synthesized FFT Spectrum (from time waveform)</text>`;
  for (const a of aTicks) {
    const y = yOf(a);
    svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#1e293b" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + 3}" fill="#64748b" font-size="10" text-anchor="end">${fmt(a)}</text>`;
  }
  for (const f of fTicks) {
    const x = xOf(f);
    svg += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="#1e293b" stroke-width="1"/>`;
    svg += `<text x="${x}" y="${H - padB + 16}" fill="#64748b" font-size="10" text-anchor="middle">${fmt(f)}</text>`;
  }
  svg += `<text x="${padL + plotW / 2}" y="${H - 6}" fill="#94a3b8" font-size="11" text-anchor="middle">Frequency (Hz)</text>`;
  svg += `<text x="14" y="${padT + plotH / 2}" fill="#94a3b8" font-size="11" text-anchor="middle" transform="rotate(-90 14 ${padT + plotH / 2})">Amplitude${ampUnit}</text>`;

  // magnitude area (filled) + line
  let area = `M ${xOf(pts[0].f)} ${padT + plotH}`;
  for (const p of pts) area += ` L ${xOf(p.f).toFixed(2)} ${yOf(p.m).toFixed(2)}`;
  area += ` L ${xOf(pts[pts.length - 1].f)} ${padT + plotH} Z`;
  svg += `<path d="${area}" fill="#0ea5e9" fill-opacity="0.18"/>`;
  let line = '';
  for (let i = 0; i < pts.length; i++) {
    line += (i === 0 ? 'M' : 'L') + ` ${xOf(pts[i].f).toFixed(2)} ${yOf(pts[i].m).toFixed(2)} `;
  }
  svg += `<path d="${line}" fill="none" stroke="#38bdf8" stroke-width="1.5"/>`;

  // peak markers with 1X/2X/3X labels where they align
  const fundamental = topPeaks[0]?.freq;
  let nextHarmonic = 1;
  for (const pk of topPeaks.slice(0, 6)) {
    if (pk.freq > fMax) break;
    const x = xOf(pk.freq);
    const y = yOf(pk.amplitude);
    let label = `${fmt(pk.freq)} Hz`;
    if (fundamental && nextHarmonic <= 6) {
      const ratio = pk.freq / fundamental;
      const n = Math.round(ratio);
      if (n >= 1 && n <= 6 && Math.abs(ratio - n) <= 0.06) {
        label = `${n}X · ${fmt(pk.freq)} Hz`;
        nextHarmonic = n + 1;
      }
    }
    svg += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="#f59e0b" stroke-width="1" stroke-dasharray="3 3" opacity="0.8"/>`;
    svg += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.5" fill="#f59e0b" stroke="#0f172a" stroke-width="1"/>`;
    const lblY = Math.max(padT + 12, y - 10);
    svg += `<text x="${x.toFixed(2)}" y="${lblY}" fill="#fbbf24" font-size="10.5" font-weight="600" text-anchor="middle">${label}</text>`;
  }

  svg += `</svg>`;
  return svg;
}

// ---- svg helpers ----

function fmt(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1).replace(/\.0$/, '');
  return n.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
}

function niceTicks(min, max, count) {
  if (max <= min) return [min];
  const range = max - min;
  const step0 = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  let step;
  if (norm < 1.5) step = 1 * mag;
  else if (norm < 3) step = 2 * mag;
  else if (norm < 7) step = 5 * mag;
  else step = 10 * mag;
  const ticks = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}
