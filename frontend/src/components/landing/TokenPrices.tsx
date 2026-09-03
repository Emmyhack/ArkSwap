'use client';

import {MUSDC, TOKEN_LIST, type Token} from '@/config/tokens';
import {poolPrice, useProtocolStats} from '@/hooks/useProtocolStats';
import {formatAmount} from '@/lib/format';

import {TokenIcon} from '../TokenIcon';

/**
 * Live prices straight from the pools.
 *
 * There is deliberately no 24h change column: without an indexer there is no
 * price history to compute one from, and inventing a number on a page that
 * looks like market data would be worse than omitting it. Each row shows the
 * fee-adjusted execution price for a 1-unit trade plus the pool's own depth.
 */
export function TokenPrices() {
  const {pools} = useProtocolStats();
  const quote = MUSDC;
  if (!quote) return null;

  const rows = TOKEN_LIST.filter((t) => t.symbol !== quote.symbol);

  return (
    <div>
      {rows.map((token: Token) => {
        const price = poolPrice(pools, token, quote);
        return (
          <div className="price-row" key={token.symbol}>
            <TokenIcon token={token} size={30} />
            <span>
              <span className="price-row__name">{token.name.split(' (')[0]}</span>
              <span className="price-row__sym">{token.symbol}</span>
            </span>
            <span className="price-row__val">
              {price !== undefined ? (
                <>
                  {formatAmount(price, quote.decimals, 4)} {quote.symbol}
                  <span className="price-row__sub">live pool price</span>
                </>
              ) : (
                <span style={{color: 'var(--faint)'}}>no pool</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
