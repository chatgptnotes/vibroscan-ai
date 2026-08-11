// Shared inline SVG icons (kept separate so component files stay small).
export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function WarnIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="mt-0.5 h-5 w-5 flex-shrink-0 text-rose-300"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v4m0 4h.01M10.3 3.86l-8.1 14a1.5 1.5 0 001.3 2.24h17a1.5 1.5 0 001.3-2.24l-8.1-14a1.5 1.5 0 00-2.6 0z"
      />
    </svg>
  );
}
