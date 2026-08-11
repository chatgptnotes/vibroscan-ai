const API_BASE = import.meta.env.VITE_API_URL || '';
const DEFAULT_TIMEOUT_MS = 180000;

function buildForm(imageFile, description) {
  const form = new FormData();
  form.append('image', imageFile, imageFile.name || 'chart.jpg');
  form.append('description', description || '');
  return form;
}

/**
 * POST the compressed image + operator description to the backend (non-streaming).
 * Auto-aborts after `timeoutMs`. Throws an Error with `.status` and `.payload`.
 */
export async function analyzeVibration({ imageFile, description, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/api/analyze-vibration`, {
      method: 'POST',
      body: buildForm(imageFile, description),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return handleFetchError(err);
  }
  clearTimeout(timer);
  return parseJsonResponse(res);
}

/**
 * POST to the streaming endpoint and dispatch SSE events to `onEvent(event, data)`.
 * Events: stage | verified | rejected | chunk | done | error.
 */
export async function analyzeVibrationStream({ imageFile, description, onEvent, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/api/analyze-stream`, {
      method: 'POST',
      body: buildForm(imageFile, description),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw handleFetchError(err);
  }

  if (!res.ok || !res.body) {
    clearTimeout(timer);
    throw await parseJsonResponse(res); // throws with status/payload
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const evt = parseSse(raw);
        if (evt) onEvent(evt.event, evt.data);
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') throw handleFetchError(err);
    throw err;
  } finally {
    clearTimeout(timer);
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
}

function parseSse(raw) {
  let event = 'message';
  let dataStr = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
  }
  let data;
  try {
    data = dataStr ? JSON.parse(dataStr) : {};
  } catch {
    data = { raw: dataStr };
  }
  return { event, data };
}

function handleFetchError(err) {
  if (err.name === 'AbortError') {
    const e = new Error('Analysis timed out — please retry.');
    e.status = 408;
    e.payload = { error: 'Request timed out', timedOut: true };
    throw e;
  }
  const e = new Error('Network error — could not reach the analysis service.');
  e.status = 0;
  e.payload = { error: err.message, networkError: true };
  throw e;
}

async function parseJsonResponse(res) {
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || 'Malformed response from server.' };
  }
  if (!res.ok) {
    const err = new Error((data && (data.error || data.reason)) || `Request failed (${res.status})`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

export async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}


