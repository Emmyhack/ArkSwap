import type {Token} from '@/config/tokens';

/**
 * Generated token mark. ArkSwap ships no third-party token logos, so each token
 * gets a deterministic gradient derived from its symbol — stable across renders
 * and impossible to confuse with an official asset.
 */
const KNOWN: Record<string, [string, string]> = {
  KASH: ['#f2f2f2', '#8a8a8a'],
  WKASH: ['#c8c8c8', '#5c5c5c'],
  mUSDC: ['#a6a6a6', '#3d3d3d'],
  mUSDT: ['#7d7d7d', '#2a2a2a'],
};

function gradientFor(symbol: string): [string, string] {
  if (KNOWN[symbol]) return KNOWN[symbol];
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) % 360;
  const l = 52 + (h % 30);
  return [`hsl(0 0% ${l}%)`, `hsl(0 0% ${Math.max(l - 38, 12)}%)`];
}

/** Relative luminance of a hex or greyscale hsl colour, 0..1. */
function luminance(color: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1], 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const hsl = /hsl\(\d+ \d+% (\d+)%\)/.exec(color);
  return hsl ? Number(hsl[1]) / 100 : 0.3;
}

export function TokenIcon({token, size = 26}: {token: Token; size?: number}) {
  const [from, to] = gradientFor(token.symbol);
  // Initials sit on the gradient's average brightness; light silver marks get
  // dark text, graphite marks keep white, so every mark reads in both themes.
  const light = (luminance(from) + luminance(to)) / 2 > 0.55;
  return (
    <span
      className="token-icon"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(140deg, ${from}, ${to})`,
        color: light ? '#0a0a0a' : '#ffffff',
        fontSize: size * 0.4,
      }}
      aria-hidden="true"
    >
      {token.symbol.replace(/^m/, '').slice(0, 2).toUpperCase()}
    </span>
  );
}
