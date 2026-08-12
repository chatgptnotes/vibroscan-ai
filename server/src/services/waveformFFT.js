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
  };
}
