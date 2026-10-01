import { useId } from 'react';

/** AgentDesk mark (docs/logo.svg): a four-point AI spark carrying the three agent colours. */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  const u = (n: string) => `url(#${id}${n})`;
  return (
    <svg viewBox="0 0 256 256" width={size} height={size} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2d2a27" />
          <stop offset="1" stopColor="#0d0c0b" />
        </linearGradient>
        <radialGradient id={`${id}halo`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#6E8BFF" stopOpacity=".38" />
          <stop offset="1" stopColor="#6E8BFF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}spark`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFB08F" />
          <stop offset=".5" stopColor="#5BE3B5" />
          <stop offset="1" stopColor="#6E8BFF" />
        </linearGradient>
        <radialGradient id={`${id}core`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fff" stopOpacity=".9" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width="256" height="256" rx="58" fill={u('bg')} />
      <circle cx="128" cy="132" r="110" fill={u('halo')} />
      <path
        filter={u('glow')}
        fill={u('spark')}
        d="M128 38 C134 100 156 122 218 128 C156 134 134 156 128 218 C122 156 100 134 38 128 C100 122 122 100 128 38 Z"
      />
      <circle cx="128" cy="128" r="30" fill={u('core')} />
      <path fill="#FFB08F" opacity=".9" d="M196 52 C198 64 202 68 214 70 C202 72 198 76 196 88 C194 76 190 72 178 70 C190 68 194 64 196 52 Z" />
      <path fill="#A9BBFF" opacity=".9" d="M62 172 C63.5 181 66.5 184 76 185.5 C66.5 187 63.5 190 62 199 C60.5 190 57.5 187 48 185.5 C57.5 184 60.5 181 62 172 Z" />
    </svg>
  );
}
