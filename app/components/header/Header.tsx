export function Header() {
  return (
    <header className="relative z-[60] flex h-12 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#090b17]/95 px-3 shadow-[0_6px_24px_rgba(0,0,0,.18)] backdrop-blur-xl sm:px-5">
      <a href="/" className="flex min-w-0 items-center gap-2.5" aria-label="The Fortz Studio home">
        <img src="/thefortzicon.png" alt="" className="h-8 w-8 object-contain" />
        <span className="truncate text-xs font-black tracking-[0.18em] text-slate-100 sm:text-sm">
          THE FORTZ <span className="text-violet-300">STUDIO</span>
        </span>
      </a>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event('thefortz:open-game-import'))}
        className="group flex h-9 items-center gap-2 border border-cyan-200/20 bg-gradient-to-r from-cyan-300/[0.08] to-violet-300/[0.08] px-3 text-xs font-semibold text-cyan-50 transition hover:border-cyan-200/45 hover:from-cyan-300/[0.14] hover:to-violet-300/[0.14] hover:shadow-[0_0_24px_rgba(34,211,238,.1)]"
        title="Upload an HTML5 game"
        aria-label="Upload an HTML5 game"
      >
        <span
          className="i-ph:upload-simple text-base text-cyan-200 transition group-hover:-translate-y-0.5"
          aria-hidden="true"
        />
        <span className="hidden sm:inline">Import game</span>
      </button>
    </header>
  );
}
