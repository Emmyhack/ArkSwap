'use client';

import {useSearchParams} from 'next/navigation';
import {useEffect, useRef} from 'react';

import {resolveToken, sameToken, tokenParam} from '@/config/tokens';
import {usePoolSelection} from '@/state/pool';
import {useTokenList} from '@/state/tokens';

/**
 * /pool?a=KASH&b=mUSDC&mode=remove — same contract as SwapUrlSync.
 */
export function PoolUrlSync() {
  const params = useSearchParams();
  const tokens = useTokenList();
  const {tokenA, tokenB, mode, select, setMode} = usePoolSelection();
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    const a = resolveToken(tokens, params.get('a'));
    const b = resolveToken(tokens, params.get('b'));
    const m = params.get('mode') === 'remove' ? 'remove' : params.get('mode') === 'add' ? 'add' : undefined;
    if (a && b && !sameToken(a, b)) select(a, b, m);
    else if (m) setMode(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!applied.current) return;
    const url = new URL(window.location.href);
    url.searchParams.set('a', tokenParam(tokenA));
    url.searchParams.set('b', tokenParam(tokenB));
    url.searchParams.set('mode', mode);
    window.history.replaceState(window.history.state, '', url.toString());
  }, [tokenA, tokenB, mode]);

  return null;
}
