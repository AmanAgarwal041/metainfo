// The mark: a single-stroke "M" whose last stroke rises like a chart line and
// ends in a data point. Reads as the letter and as "visibility going up".

export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M8 23V10.5l8 9.5 8-11" fill="none" stroke="var(--accent-ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="9" r="2.6" fill="var(--accent-ink)" />
    </svg>
  );
}

export function Logo() {
  return (
    <>
      <LogoMark size={26} />
      <span>metainfo</span>
    </>
  );
}
