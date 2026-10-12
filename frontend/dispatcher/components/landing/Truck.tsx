/**
 * Top-down linehaul truck, drawn facing down the page (+y) and centred on the origin so
 * the scroll loop can place it with a single translate + rotate. Units are CSS pixels.
 */
export function Truck() {
  return (
    <g>
      <defs>
        <filter id="fp-truck-shadow" x="-60%" y="-30%" width="220%" height="160%">
          <feDropShadow dx="0" dy="4" stdDeviation="3.5" floodColor="black" floodOpacity="0.45" />
        </filter>
      </defs>

      <g filter="url(#fp-truck-shadow)">
        {/* Trailer roof */}
        <rect x="-16" y="-54" width="32" height="72" rx="3" className="fill-surf-lowest stroke-outline-v" strokeWidth="1" />
        {[-42, -30, -18, -6, 6].map(y => (
          <line key={y} x1="-12.5" x2="12.5" y1={y} y2={y} className="stroke-surf-high" strokeWidth="1" />
        ))}
        {/* Fifth-wheel coupling */}
        <rect x="-4" y="17" width="8" height="6" rx="1" className="fill-on-surf-v" />
        {/* Cab — action blue, the design system's colour for what is live right now; ink
            would vanish against the asphalt. */}
        <rect x="-15" y="21" width="30" height="25" rx="5" className="fill-sec stroke-sec-c" strokeWidth="1" />
        <rect x="-11.5" y="37.5" width="23" height="5.5" rx="2" className="fill-sec-onc" />
        <rect x="-18.5" y="35" width="3.5" height="4.5" rx="1" className="fill-sec" />
        <rect x="15" y="35" width="3.5" height="4.5" rx="1" className="fill-sec" />
        <circle cx="-10" cy="45.6" r="1.5" fill="white" />
        <circle cx="10" cy="45.6" r="1.5" fill="white" />
      </g>
    </g>
  )
}
