export function Logo({ className = "size-9" }: { className?: string }) {
  return (
    <div className={`${className} grid shrink-0 place-items-center rounded-[10px] bg-[#087f76] shadow-sm ring-1 ring-white/10`}>
      <svg viewBox="0 0 24 24" className="size-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 12h4l2.5-6 5 12L17 12h4" />
      </svg>
    </div>
  );
}
