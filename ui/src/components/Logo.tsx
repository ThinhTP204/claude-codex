/** AgentDesk mark: three stacked tasks (plan · code · test) handed down from one agent to the next. */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 128 128" width={size} height={size} className={className} aria-hidden="true">
      <rect width="128" height="128" rx="28" fill="#1f1e1c" />
      <path d="M84 42 q14 0 14 12" fill="none" stroke="#5a5750" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M44 86 q-14 0 -14 -12" fill="none" stroke="#5a5750" strokeWidth="3.5" strokeLinecap="round" />
      <rect x="30" y="34" width="52" height="16" rx="8" fill="#D97757" />
      <rect x="46" y="56" width="52" height="16" rx="8" fill="#10A37F" />
      <rect x="30" y="78" width="52" height="16" rx="8" fill="#8f8a80" />
    </svg>
  );
}
