'use client';

import {ANALYTICS_UNAVAILABLE} from '@arkswap/sdk';
import type {SwapRecord} from '@arkswap/types';

import {explorerTxUrl} from '@/config/chain';
import {TOKEN_LIST} from '@/config/tokens';
import {useRecentTrades} from '@/hooks/useRecentTrades';
import {formatAmount} from '@/lib/format';

/**
 * Recent trades across the deepest pools.
 *
 * Every row is an indexed on-chain Swap event, so this is history rather than a
 * forecast. When the indexer is unreachable the panel says so and disappears
 * from the decision path — quoting and swapping read the chain directly
 * (llm.txt s38).
 */
export function RecentTrades() {
  const {data, isLoading} = useRecentTrades(8);

  const trades = data?.ok ? data.data : undefined;
  const unavailable = Boolean(data && !data.ok);

  // Nothing has traded yet and the API is healthy: an empty table reads as
  // breakage, so say what is actually true instead.
  if (!isLoading && !unavailable && trades?.length === 0) return null;

  return (
    <section className="section">
      <h2 className="section__title">Recent trades</h2>
      <p className="section__lede">
        Swap events indexed from the chain, newest first, across the deepest pools.
      </p>

      <div className="card trades" style={{marginTop: 24}}>
        {unavailable && <div className="alert alert--warn">{ANALYTICS_UNAVAILABLE}</div>}

        {isLoading && !trades && <div className="trades__empty">Loading recent activity…</div>}

        {trades?.map((trade) => (
          <TradeRow key={`${trade.txHash}-${trade.logIndex}`} trade={trade} />
        ))}
      </div>
    </section>
  );
}

function TradeRow({trade}: {trade: SwapRecord}) {
  const url = explorerTxUrl(trade.txHash);
  const inLeg = leg(trade.tokenIn, trade.tokenInSymbol, trade.amountIn);
  const outLeg = leg(trade.tokenOut, trade.tokenOutSymbol, trade.amountOut);

  const body = (
    <>
      <span className="trades__pair">
        {inLeg.symbol} → {outLeg.symbol}
      </span>
      <span className="trades__amounts">
        {inLeg.amount} <span className="trades__arrow">→</span> {outLeg.amount}
      </span>
      <span className="trades__usd">
        {/* Priced from the stablecoin leg where there is one; a pool with no
            route to a stable is left blank rather than guessed (llm.txt s23). */}
        {trade.amountUsd ? `$${trimUsd(trade.amountUsd)}` : <span className="trades__muted">—</span>}
      </span>
      <span className="trades__age">{age(trade.timestamp)}</span>
    </>
  );

  return url ? (
    <a className="trades__row trades__row--link" href={url} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <div className="trades__row">{body}</div>
  );
}

/**
 * Formats one side of a swap.
 *
 * Decimals come from the deployment manifest, which is the same source the swap
 * form uses. An unknown token is shown by its short address with no amount
 * rather than scaled by a guessed exponent — a wrong exponent here would be a
 * silently wrong number (llm.txt s13).
 */
function leg(address: string | null, symbol: string | null, amount: string | null) {
  const token = address
    ? TOKEN_LIST.find((t) => t.address?.toLowerCase() === address.toLowerCase())
    : undefined;

  const label = symbol ?? token?.symbol ?? (address ? shorten(address) : 'unknown');
  if (!amount || !token) return {symbol: label, amount: '—'};

  try {
    return {symbol: label, amount: formatAmount(BigInt(amount), token.decimals, 4)};
  } catch {
    return {symbol: label, amount: '—'};
  }
}

function shorten(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Shortens the API's exact decimal string for display only. */
function trimUsd(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n >= 1000 ? n.toFixed(0) : n.toFixed(2);
}

function age(timestamp: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}
