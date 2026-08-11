import ImageCapture from './components/ImageCapture.jsx';
import SpeechInput from './components/SpeechInput.jsx';
import AnalysisReport from './components/AnalysisReport.jsx';
import { Spinner, WarnIcon } from './components/Icons.jsx';
import { STATUS } from './status.js';

export default function AppBody(props) {
  const {
    image, description, setDescription, liveTranscript, lang, setLang,
    busy, status, stageLabel, result, error,
    onImage, onTranscript, handleAnalyze, reset,
  } = props;

  return (
    <main className="flex-1 space-y-5 px-4 pb-10">
      <section className="rounded-3xl bg-slate-900/60 p-4 ring-1 ring-slate-800 backdrop-blur">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">1. Capture Vibration Graph</h2>
        <ImageCapture onImage={onImage} previewUrl={image?.previewUrl} disabled={busy} />
        {!image?.previewUrl && (
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Accepted: FFT spectrum, time waveform, orbit, Bode/Polar, cascade/waterfall,
            envelope, cepstrum, or a SCADA vibration screen. Hold the camera steady and frame
            the axes + peaks clearly.
          </p>
        )}
      </section>

      <section className="rounded-3xl bg-slate-900/60 p-4 ring-1 ring-slate-800 backdrop-blur">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-300">2. Operator Notes (optional)</h2>
          <SpeechInput onTranscript={onTranscript} lang={lang} setLang={setLang} disabled={busy} />
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
          rows={3}
          placeholder="e.g. Motor running at 1500 RPM, high vibration alarm on DE bearing since yesterday…"
          className="w-full resize-y rounded-2xl bg-slate-950/70 p-3 text-sm text-slate-100 placeholder-slate-500 ring-1 ring-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        {liveTranscript && (
          <p className="mt-1 text-xs italic text-sky-300/80">🎙 {liveTranscript}</p>
        )}
      </section>

      <button
        type="button"
        onClick={handleAnalyze}
        disabled={!image?.file || busy}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-500 px-5 py-4 text-base font-bold text-white shadow-lg shadow-sky-500/25 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy && <Spinner />}
        {busy ? stageLabel || 'Working…' : 'Analyze Vibration Graph'}
      </button>

      {status === STATUS.ERROR && (
        <section className="rounded-3xl border border-rose-500/40 bg-rose-500/10 p-4">
          <div className="flex items-start gap-3">
            <WarnIcon />
            <div className="min-w-0">
              <p className="font-semibold text-rose-200">
                {error?.verified === false
                  ? 'Image not recognized'
                  : error?.serviceError
                    ? 'Service temporarily unavailable'
                    : 'Analysis failed'}
              </p>
              <p className="mt-1 break-words text-sm text-rose-100/90">
                {error?.reason || error?.message}
              </p>
              {error?.verified === false && (
                <p className="mt-2 text-xs text-rose-200/70">
                  Tip: upload a clear photo of an FFT spectrum, time waveform, orbit, Bode/Polar
                  plot, or SCADA vibration screen.
                </p>
              )}
              {error?.serviceError && (
                <p className="mt-2 text-xs text-rose-200/70">
                  The AI service may be busy or rate-limited. Please wait a moment and retry.
                </p>
              )}
            </div>
          </div>
          <button
            onClick={reset}
            className="mt-3 rounded-full bg-rose-500/20 px-4 py-2 text-sm font-semibold text-rose-100 ring-1 ring-rose-500/40"
          >
            Try Again
          </button>
        </section>
      )}

      {result && (status === STATUS.DONE || status === STATUS.STREAMING) && (
        <section className="rounded-3xl bg-slate-900/60 p-5 ring-1 ring-slate-800 backdrop-blur">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">Diagnostic Report</h2>
              {result.streaming ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-300 ring-1 ring-sky-500/30">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-sky-400" />
                  streaming
                </span>
              ) : (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                  complete
                </span>
              )}
            </div>
            {status === STATUS.DONE && (
              <button
                onClick={reset}
                className="rounded-full bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 ring-1 ring-slate-700"
              >
                New Analysis
              </button>
            )}
          </div>
          <AnalysisReport result={result} />
        </section>
      )}
    </main>
  );
}
