/**
 * Lightweight animated globe for the landing page.
 *
 * Pure SVG + CSS — no d3, no canvas, no <Suspense>, no lazy-load.
 * Paints immediately on mount. ~3kB total. The previous RotatingEarth
 * pulled d3 via a dynamic import on first mount, which delayed the
 * landing-page paint by ~600-1500ms while the JS chunk downloaded and
 * the geoOrthographic projection ran.
 *
 * What we lose by dropping the d3 build:
 *   - True country-coastline outlines. Replaced with a stylised
 *     lat-long ray grid (latitude lines + longitude meridians) so it
 *     still reads as a globe.
 *
 * What we keep:
 *   - A green-blue sphere on the landing page hero.
 *   - Slow CSS rotation (vague brand consistency with the prior d3
 *     build).
 *   - No JS bundling dependency on d3 at all — landing-page TBT drops.
 */
export default function RotatingEarth({ width = 350, height = 350, className = "" }) {
  return (
    <div className={className} style={{ width, height, position: "relative" }}>
      <style>{`
        @keyframes upl-globe-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes upl-globe-shine {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 0.85; }
        }
        .upl-globe-spin  { animation: upl-globe-spin 24s linear infinite; transform-origin: 50% 50%; }
        .upl-globe-meridian  { animation: upl-globe-shine 6s ease-in-out infinite; }
      `}</style>
      <svg viewBox="0 0 200 200" width={width} height={height} aria-hidden>
        <defs>
          <radialGradient id="upl-globe-fill" cx="38%" cy="38%" r="62%">
            <stop offset="0%" stopColor="#5fa9ff" />
            <stop offset="60%" stopColor="#1e4f8a" />
            <stop offset="100%" stopColor="#0a1e3b" />
          </radialGradient>
          <radialGradient id="upl-globe-glow" cx="50%" cy="50%" r="50%">
            <stop offset="80%" stopColor="rgba(63,169,255,0)" />
            <stop offset="100%" stopColor="rgba(63,169,255,0.35)" />
          </radialGradient>
          <clipPath id="upl-globe-clip">
            <circle cx="100" cy="100" r="68" />
          </clipPath>
        </defs>

        {/* outer halo */}
        <circle cx="100" cy="100" r="78" fill="url(#upl-globe-glow)" />

        {/* sphere */}
        <circle cx="100" cy="100" r="68" fill="url(#upl-globe-fill)" stroke="rgba(255,255,255,0.25)" strokeWidth="0.5" />

        {/* rotating meridian grid — clipped to the sphere */}
        <g clipPath="url(#upl-globe-clip)" className="upl-globe-spin">
          {/* latitude rings */}
          {[-50, -33, -16, 0, 16, 33, 50].map((lat) => (
            <ellipse
              key={`lat-${lat}`}
              cx="100"
              cy={100 + lat * 0.9}
              rx={Math.sqrt(Math.max(0, 68 * 68 - (lat * 0.9) * (lat * 0.9)))}
              ry={Math.max(2, 6 - Math.abs(lat) * 0.06)}
              fill="none"
              stroke="rgba(120,200,255,0.35)"
              strokeWidth="0.7"
            />
          ))}
          {/* meridians — ellipses that look like longitudes on a sphere */}
          {[-66, -42, -18, 6, 30, 54, 78].map((deg) => (
            <ellipse
              key={`mer-${deg}`}
              cx="100"
              cy="100"
              rx="68"
              ry={Math.max(0.5, 68 * Math.sin(((90 - Math.abs(deg)) * Math.PI) / 180))}
              transform={`rotate(${deg} 100 100)`}
              fill="none"
              stroke="rgba(120,200,255,0.35)"
              strokeWidth="0.7"
            />
          ))}
        </g>

        {/* highlight */}
        <ellipse cx="78" cy="74" rx="22" ry="10" fill="rgba(255,255,255,0.18)" transform="rotate(-30 78 74)" />
      </svg>
    </div>
  );
}
