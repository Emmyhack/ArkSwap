import {formatUnits, parseUnits} from 'viem';

/** Formats a token amount for display, trimming trailing zeros. */
export function formatAmount(value: bigint, decimals: number, maxFractionDigits = 6): string {
  const raw = formatUnits(value, decimals);
  const [whole, fraction = ''] = raw.split('.');
  const trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/, '');
  const grouped = BigInt(whole).toLocaleString('en-US');
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

/** Parses user input, returning `null` for anything not a valid amount. */
export function parseAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!trimmed || !/^\d*\.?\d*$/.test(trimmed)) return null;
  try {
    const value = parseUnits(trimmed as `${number}`, decimals);
    return value >= 0n ? value : null;
  } catch {
    return null;
  }
}

export function formatBps(bps: bigint): string {
  const whole = bps / 100n;
  const frac = bps % 100n;
  return frac === 0n ? `${whole}%` : `${whole}.${frac.toString().padStart(2, '0')}%`;
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
