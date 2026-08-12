import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders the Markdown diagnostic report returned by Tier 2.
 * Includes a copy-to-clipboard action and an optional provider/model badge.
 */
export default function AnalysisReport({ result }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.report || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
          ✓ AI-verified
        </span>
        {result.provider && result.model && (
          <span className="rounded-full bg-slate-800 px-2.5 py-1 text-slate-300 ring-1 ring-slate-700">
            {String(result.provider).toUpperCase()} · {result.model}
          </span>
        )}
        <button
          type="button"
          onClick={copy}
          className="ml-auto inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 font-semibold text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <div className="report-body">
        {result.spectrumImage && (
          <figure className="mb-4 overflow-hidden rounded-2xl bg-slate-900/60 ring-1 ring-slate-800">
            <img
              src={result.spectrumImage}
              alt="Synthesized FFT spectrum from the time-waveform input"
              className="mx-auto w-full max-w-2xl"
            />
            <figcaption className="px-3 py-1.5 text-center text-[11px] text-slate-400">
              Synthesized FFT spectrum — peaks labeled 1X/2X/3X where they align with the dominant frequency
            </figcaption>
          </figure>
        )}
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.report || ''}</ReactMarkdown>
      </div>
    </div>
  );
}

