import { useCallback, useEffect, useRef, useState } from 'react';
import Header from './components/Header.jsx';
import { compressImage } from './lib/compress.js';
import { analyzeVibrationStream } from './lib/api.js';
import AppBody from './AppBody.jsx';
import { STATUS } from './status.js';

// Whole-pipeline client timeout (verify + diagnose are two model calls).
// Pro reasoning models (gemini-3.1-pro-preview) take ~100s to first token, so
// keep this >= server REQUEST_TIMEOUT_MS to avoid premature client aborts.
const CLIENT_TIMEOUT_MS = 240000;

export default function App() {
  const [image, setImage] = useState(null); // { file, previewUrl, ... }
  const [description, setDescription] = useState('');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [lang, setLang] = useState('en-IN');
  const [status, setStatus] = useState(STATUS.IDLE);
  const [result, setResult] = useState(null); // { report, provider, model, streaming }
  const [error, setError] = useState(null);
  const [streamStage, setStreamStage] = useState('verifying');
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);

  // Live "elapsed" counter while analyzing/streaming — drives the phase label.
  useEffect(() => {
    if (status !== STATUS.ANALYZING && status !== STATUS.STREAMING) {
      setElapsed(0);
      return undefined;
    }
    startRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  const onImage = useCallback(async (file) => {
    setError(null);
    setResult(null);
    setStatus(STATUS.COMPRESSING);
    const compressed = await compressImage(file, { maxWidth: 1600, quality: 0.8 });
    setImage(compressed);
    setStatus(STATUS.IDLE);
  }, []);

  const onTranscript = useCallback((text, isInterim) => {
    if (isInterim) {
      setLiveTranscript(text);
    } else {
      setDescription((prev) => {
        const base = prev && !prev.endsWith(' ') ? prev + ' ' : prev || '';
        return (base + text.trim()).trim();
      });
      setLiveTranscript('');
    }
  }, []);

  const handleAnalyze = async () => {
    if (!image?.file) return;
    setStatus(STATUS.ANALYZING);
    setStreamStage('verifying');
    setError(null);
    setResult(null);

    let partial = '';
    try {
      await analyzeVibrationStream({
        imageFile: image.file,
        description,
        timeoutMs: CLIENT_TIMEOUT_MS,
        onEvent: (event, data) => {
          switch (event) {
            case 'stage':
              setStreamStage(data.stage || 'verifying');
              break;
            case 'chunk':
              partial += data.text || '';
              setResult({ report: partial, provider: null, model: null, streaming: true });
              setStatus(STATUS.STREAMING);
              break;
            case 'done':
              setResult({
                report: partial,
                provider: data.provider,
                model: data.model,
                streaming: false,
              });
              setStatus(STATUS.DONE);
              break;
            case 'rejected':
              setError({
                verified: false,
                message: 'Image not recognized as a vibration graph.',
                reason: data.reason,
              });
              setStatus(STATUS.ERROR);
              break;
            case 'error':
              setError({
                message: data.message,
                reason: data.message,
                serviceError: data.serviceError,
              });
              setStatus(STATUS.ERROR);
              break;
            default:
              break;
          }
        },
      });
    } catch (err) {
      setError({
        message: err.message,
        reason: err.payload?.reason || err.message,
        verified: err.payload?.verified === false,
        serviceError: err.status === 502 || err.status === 408 || err.payload?.timedOut,
      });
      setStatus(STATUS.ERROR);
    }
  };

  const reset = () => {
    setImage(null);
    setDescription('');
    setLiveTranscript('');
    setStatus(STATUS.IDLE);
    setResult(null);
    setError(null);
  };

  const busy =
    status === STATUS.ANALYZING || status === STATUS.COMPRESSING || status === STATUS.STREAMING;

  // Derive the stage label from real status/elapsed so all phases are visible.
  let stageLabel = '';
  if (status === STATUS.COMPRESSING) stageLabel = 'Optimizing image…';
  else if (status === STATUS.ANALYZING) {
    stageLabel =
      streamStage === 'diagnosing'
        ? `Running diagnostic reasoning… (${elapsed}s)`
        : `Verifying image authenticity… (${elapsed}s)`;
  } else if (status === STATUS.STREAMING) {
    stageLabel = `Generating report… (${elapsed}s)`;
  }

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col">
      <Header />
      <AppBody
        image={image}
        description={description}
        setDescription={setDescription}
        liveTranscript={liveTranscript}
        lang={lang}
        setLang={setLang}
        busy={busy}
        status={status}
        stageLabel={stageLabel}
        result={result}
        error={error}
        onImage={onImage}
        onTranscript={onTranscript}
        handleAnalyze={handleAnalyze}
        reset={reset}
      />
      <footer className="px-5 py-4 text-center text-[11px] text-slate-600">
        MVP · Built on the Brüel &amp; Kjær Vibro Diagnostic Chart ·{' '}
        {result?.provider ? `${result.provider.toUpperCase()} powered` : 'Gemini / GLM powered'}
      </footer>
    </div>
  );
}


