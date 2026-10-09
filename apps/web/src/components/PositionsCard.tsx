'use client';

import {useAccount} from 'wagmi';

import {KASH, type Token, tokenByAddress} from '@/config/tokens';
import {WKASH_ADDRESS} from '@/config/contracts';
import {type Position, usePositions} from '@/hooks/usePositions';
import {formatAmount, formatBps} from '@/lib/format';
import {type PoolToken, formatUsd} from '@/lib/valuation';
import {usePoolSelection} from '@/state/pool';
import {useTokenList} from '@/state/tokens';

import {Skeleton} from './Skeleton';
import {TokenIcon} from './TokenIcon';

/**
 * Every pool the connected wallet holds LP tokens in, read from the chain.
 * "Add" and "Remove" point the liquidity form at the pair.
 */
export function PositionsCard() {
  const {isConnected} = useAccount();
  const {positions, isLoading} = usePositions();
  const {select} = usePoolSelection();
  const tokens = useTokenList();

  function asToken(t: PoolToken): Token {
    // A WKASH side is offered to the form as native KASH: that is what the
    // router's ETH-suffixed calls hand back on removal, and what most users
    // hold. The pool is the same either way.
    if (WKASH_ADDRESS && t.address.toLowerCase() === WKASH_ADDRESS.toLowerCase()) return KASH;
    return (
      tokenByAddress(tokens, t.address) ?? {
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        isImported: true,
      }
    );
  }

  if (!isConnected) return null;

  return (
    <section className="card positions">
      <div className="card__header">
        <div>
          <h3 className="card__title">Your positions</h3>
          <span className="pool-chart__sub">LP balances read from every ArkSwap pair</span>
        </div>
      </div>

      {isLoading && positions.length === 0 && (
        <div className="positions__list">
          {[0, 1].map((i) => (
            <div className="positions__row" key={i}>
              <Skeleton width={36} height={36} style={{borderRadius: 18}} />
              <span className="token-list__text">
                <Skeleton width={120} height={16} />
                <br />
                <Skeleton width={180} height={12} style={{marginTop: 6}} />
              </span>
            </div>
          ))}
        </div>
      )}

      {!isLoading && positions.length === 0 && (
        <div className="pool-chart__empty">No liquidity positions yet. Add liquidity above to earn the 0.30% fee.</div>
      )}

      {positions.length > 0 && (
        <div className="positions__list">
          {positions.map((p) => (
            <PositionRow key={p.pair} position={p} onManage={(mode) => select(asToken(p.token0), asToken(p.token1), mode)} />
          ))}
        </div>
      )}
    </section>
  );
}

function PositionRow({position: p, onManage}: {position: Position; onManage: (mode: 'add' | 'remove') => void}) {
  const t0 = p.token0;
  const t1 = p.token1;
  return (
    <div className="positions__row">
      <span className="pair-icons" aria-hidden>
        <TokenIcon token={t0} size={30} />
        <TokenIcon token={t1} size={30} />
      </span>
      <span className="token-list__text">
        <span className="token-list__name">
          {t0.symbol} / {t1.symbol}
          {(!t0.known || !t1.known) && <span className="badge badge--warn" style={{marginLeft: 8}}>unverified</span>}
        </span>
        <span className="token-list__meta">
          <span className="mono">
            {formatAmount(p.amount0, t0.decimals, 4)} {t0.symbol} + {formatAmount(p.amount1, t1.decimals, 4)} {t1.symbol}
          </span>
        </span>
      </span>
      <span className="positions__value">
        <span className="mono">{p.value !== undefined ? formatUsd(p.value) : formatBps(p.shareBps)}</span>
        <span className="price-row__sub">{p.value !== undefined ? `${formatBps(p.shareBps)} of pool` : 'pool share'}</span>
      </span>
      <span className="positions__actions">
        <button type="button" className="settings__chip" onClick={() => onManage('add')}>
          Add
        </button>
        <button type="button" className="settings__chip" onClick={() => onManage('remove')}>
          Remove
        </button>
      </span>
    </div>
  );
}
