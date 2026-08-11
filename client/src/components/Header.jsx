export default function Header() {
  return (
    <header className="px-5 pt-6 pb-3 text-center">
      <div className="inline-flex items-center gap-2 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300 ring-1 ring-sky-500/30">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
        Brüel &amp; Kjær Diagnostic Standard
      </div>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-white">VibrationCheck</h1>
      <p className="mt-1 text-sm text-slate-400">AI-powered SCADA vibration graph analyzer</p>
    </header>
  );
}
