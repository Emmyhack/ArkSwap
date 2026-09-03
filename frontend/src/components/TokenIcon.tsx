import type {Token} from '@/config/tokens';

/**
 * Generated token mark. ArkSwap ships no third-party token logos, so each token
 * gets a deterministic gradient derived from its symbol — stable across renders
 * and impossible to confuse with an official asset.
 */
const KNOWN: Record<string, [string, string]> = {
  KASH: ['#c48bff', '#7c3aed'],
  WKASH: ['#a855f7', '#5b21b6'],
  mUSDC: ['#5aa9ff', '#1e4fd8'],
  mUSDT: ['#3ecf8e', '#0f7a55'],
};

function gradientFor(symbol: string): [string, string] {
  if (KNOWN[symbol]) return KNOWN[symbol];
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) % 360;
  return [`hsl(${h} 80% 68%)`, `hsl(${(h + 40) % 360} 72% 42%)`];
}

export function TokenIcon({token, size = 26}: {token: Token; size?: number}) {
  const [from, to] = gradientFor(token.symbol);
  return (
    <span
      className="token-icon"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(140deg, ${from}, ${to})`,
        fontSize: size * 0.4,
      }}
      aria-hidden="true"
    >
      {token.symbol.replace(/^m/, '').slice(0, 2).toUpperCase()}
    </span>
  );
}
