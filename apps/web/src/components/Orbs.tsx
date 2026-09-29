/**
 * Soft blurred colour fields drifting behind the page.
 *
 * The reference layout floats token logos in the background; ArkSwap uses
 * abstract monochrome fields instead, so no third-party token or brand
 * artwork is reproduced (llm.txt s50). The colour comes from --orb-rgb so the
 * orbs invert with the theme.
 */
const ORBS = [
  {top: '4%', left: '6%', size: 210, alpha: 0.14, dx: '32px', dy: '-42px', dur: '24s'},
  {top: '16%', left: '80%', size: 175, alpha: 0.16, dx: '-36px', dy: '32px', dur: '30s'},
  {top: '52%', left: '3%', size: 240, alpha: 0.10, dx: '42px', dy: '28px', dur: '34s'},
  {top: '64%', left: '82%', size: 200, alpha: 0.13, dx: '-28px', dy: '-34px', dur: '27s'},
  {top: '30%', left: '20%', size: 150, alpha: 0.09, dx: '24px', dy: '30px', dur: '22s'},
  {top: '78%', left: '30%', size: 190, alpha: 0.12, dx: '-32px', dy: '-22px', dur: '29s'},
  {top: '8%', left: '52%', size: 130, alpha: 0.08, dx: '20px', dy: '36px', dur: '26s'},
  {top: '86%', left: '66%', size: 165, alpha: 0.10, dx: '30px', dy: '-26px', dur: '32s'},
  {top: '44%', left: '70%', size: 120, alpha: 0.08, dx: '-22px', dy: '24px', dur: '21s'},
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
              background: `radial-gradient(circle at 32% 30%, rgba(var(--orb-rgb), ${o.alpha}), transparent 68%)`,
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
