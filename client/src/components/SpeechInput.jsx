import { useEffect, useRef, useState } from 'react';

const LANGS = [
  { code: 'en-IN', label: 'English (IN)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'hi-IN', label: 'हिन्दी (Hindi)' },
];

/**
 * Bilingual Speech-to-Text via the native Web Speech API.
 * - `onTranscript(text, isInterim)` is called on each result segment.
 *   Final segments should be appended to the notes; interim segments shown live.
 */
export default function SpeechInput({ onTranscript, lang, setLang, disabled }) {
  const recognitionRef = useRef(null);
  const wantListeningRef = useRef(false);
  const lastFinalRef = useRef(''); // tracks last appended final text (de-dup for mobile)
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onresult = (event) => {
      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += transcript + ' ';
        else interim += transcript;
      }
      if (finalText.trim()) {
        // De-duplicate: on mobile WebView, the auto-restart re-emits the last
        // final segment. If the new text matches the tail of what was already
        // appended, skip it to prevent word repetition.
        const trimmed = finalText.trim();
        const tail = lastFinalRef.current.slice(-trimmed.length - 10);
        if (tail.toLowerCase().includes(trimmed.toLowerCase()) && trimmed.length < lastFinalRef.current.length + 5) {
          // Duplicate — skip.
        } else {
          onTranscript(finalText, false);
          lastFinalRef.current = trimmed;
        }
      } else if (interim) {
        onTranscript(interim, true);
      }
    };

    recognition.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantListeningRef.current = false;
        setListening(false);
      }
    };

    recognition.onend = () => {
      // Auto-restart while the user still intends to listen (handles brief pauses).
      if (wantListeningRef.current) {
        try {
          recognition.start();
        } catch (_) {
          /* already started */
        }
      } else {
        setListening(false);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      wantListeningRef.current = false;
      try {
        recognition.stop();
      } catch (_) {
        /* noop */
      }
      recognitionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const toggle = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (listening) {
      wantListeningRef.current = false;
      try {
        recognition.stop();
      } catch (_) {
        /* noop */
      }
      setListening(false);
    } else {
      wantListeningRef.current = true;
      try {
        recognition.start();
        setListening(true);
      } catch (_) {
        /* noop */
      }
    }
  };

  if (!supported) {
    return (
      <span className="text-[11px] text-slate-500">Voice input unsupported here</span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
          listening
            ? 'bg-rose-500 text-white'
            : 'bg-slate-800 text-slate-100 ring-1 ring-slate-700'
        }`}
      >
        <MicIcon active={listening} />
        {listening ? 'Stop' : 'Speak'}
      </button>

      <select
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        disabled={disabled || listening}
        className="rounded-full bg-slate-800 px-2.5 py-1.5 text-[11px] text-slate-200 ring-1 ring-slate-700 disabled:opacity-50"
        aria-label="Speech language"
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function MicIcon({ active }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={`h-3.5 w-3.5 ${active ? 'animate-pulse' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2a3 3 0 00-3 3v6a3 3 0 006 0V5a3 3 0 00-3-3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 11a7 7 0 0014 0M12 18v3" />
    </svg>
  );
}
