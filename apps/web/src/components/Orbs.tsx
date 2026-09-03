/**
 * Soft blurred colour fields drifting behind the page.
 *
 * The reference layout floats token logos in the background; ArkSwap uses
 * abstract purple/violet fields instead, so no third-party token or brand
 * artwork is reproduced (llm.txt s50).
 */
const ORBS = [
  {top: '4%', left: '6%', size: 210, color: 'rgba(168,85,247,0.55)', dx: '32px', dy: '-42px', dur: '24s'},
  {top: '16%', left: '80%', size: 175, color: 'rgba(124,58,237,0.60)', dx: '-36px', dy: '32px', dur: '30s'},
  {top: '52%', left: '3%', size: 240, color: 'rgba(196,139,255,0.42)', dx: '42px', dy: '28px', dur: '34s'},
  {top: '64%', left: '82%', size: 200, color: 'rgba(168,85,247,0.48)', dx: '-28px', dy: '-34px', dur: '27s'},
  {top: '30%', left: '20%', size: 150, color: 'rgba(216,180,254,0.34)', dx: '24px', dy: '30px', dur: '22s'},
  {top: '78%', left: '30%', size: 190, color: 'rgba(124,58,237,0.40)', dx: '-32px', dy: '-22px', dur: '29s'},
  {top: '8%', left: '52%', size: 130, color: 'rgba(216,180,254,0.30)', dx: '20px', dy: '36px', dur: '26s'},
  {top: '86%', left: '66%', size: 165, color: 'rgba(168,85,247,0.36)', dx: '30px', dy: '-26px', dur: '32s'},
  {top: '44%', left: '70%', size: 120, color: 'rgba(196,139,255,0.30)', dx: '-22px', dy: '24px', dur: '21s'},
];


export function Orbs() {
  return (
    <div className="orbs" aria-hidden="true">
      {ORBS.map((o, i) => (
        <span
          key={i}
          className="orb"
          style={
            {
              top: o.top,
              left: o.left,
              width: o.size,
              height: o.size,
              background: `radial-gradient(circle at 32% 30%, ${o.color}, transparent 68%)`,
              '--dx': o.dx,
              '--dy': o.dy,
              '--dur': o.dur,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
