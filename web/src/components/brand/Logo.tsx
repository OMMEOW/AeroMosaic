import { useId } from "react";

/**
 * AeroMosaic mark: a quadcopter projecting its camera footprint onto the newest of three
 * successive aerial frames, stitched into one mosaic. Same artwork as app/icon.svg.
 */
export function LogoMark({ size = 20, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#172554" />
          <stop offset="1" stopColor="#0c4a6e" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${id}-sky)`} />
      <path d="M40 17 L27.4 35.2 M40 17 L55.6 38.3" stroke="#7dd3fc" strokeWidth="1.2" strokeOpacity="0.7" strokeDasharray="2 2" />
      <g stroke="#082f49" strokeWidth="1.6" strokeLinejoin="round">
        <rect x="6" y="33" width="24" height="18" rx="2.5" fill="#38bdf8" transform="rotate(-10 18 42)" />
        <rect x="17" y="31" width="24" height="18" rx="2.5" fill="#7dd3fc" transform="rotate(-2 29 40)" />
        <rect x="28" y="33" width="24" height="18" rx="2.5" fill="#e0f2fe" transform="rotate(8 40 42)" />
      </g>
      <path d="M34.5 11.5 L45.5 22.5 M45.5 11.5 L34.5 22.5" stroke="#fbbf24" strokeWidth="2.2" strokeLinecap="round" />
      <g fill="#0c4a6e" stroke="#fbbf24" strokeWidth="1.8">
        <circle cx="34.5" cy="11.5" r="3.4" />
        <circle cx="45.5" cy="11.5" r="3.4" />
        <circle cx="34.5" cy="22.5" r="3.4" />
        <circle cx="45.5" cy="22.5" r="3.4" />
      </g>
      <rect x="37.3" y="14.3" width="5.4" height="5.4" rx="1.4" fill="#fbbf24" />
    </svg>
  );
}

export const PRODUCT_NAME = "AeroMosaic";
