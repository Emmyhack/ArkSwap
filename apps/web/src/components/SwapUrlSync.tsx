'use client';

import {useSearchParams} from 'next/navigation';
import {useEffect, useRef} from 'react';

import {resolveToken, sameToken, tokenParam} from '@/config/tokens';
import {type SwapSide, useSwapTokens} from '@/state/swap';
import {useTokenList} from '@/state/tokens';

/**
 * Keeps the swap form and the address bar in step.
 *
 *   /swap?in=KASH&out=mUSDC&amount=1.5&side=in
 *
 * On first render the URL wins, so a shared link opens the same trade. After
 * that the form writes its state back with replaceState, so copying the
 * address bar at any moment yields a working link without a history entry per
 * keystroke. Must be rendered inside a Suspense boundary (useSearchParams).
 */
export function SwapUrlSync() {
  const params = useSearchParams();
  const tokens = useTokenList();
  const {tokenIn, tokenOut, typed, setTokenIn, setTokenOut, setTyped} = useSwapTokens();
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    const inTok = resolveToken(tokens, params.get('in'));
    const outTok = resolveToken(tokens, params.get('out'));
    const nextIn = inTok ?? tokenIn;
    const nextOut = outTok ?? tokenOut;
    if (inTok && !sameToken(inTok, nextOut)) setTokenIn(inTok);
    if (outTok && !sameToken(outTok, nextIn)) setTokenOut(outTok);
    const amount = params.get('amount');
    const side: SwapSide = params.get('side') === 'out' ? 'out' : 'in';
    if (amount && /^\d*\.?\d*$/.test(amount)) setTyped({side, value: amount});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!applied.current) return;
    const url = new URL(window.location.href);
    url.searchParams.set('in', tokenParam(tokenIn));
    url.searchParams.set('out', tokenParam(tokenOut));
    if (typed.value) {
      url.searchParams.set('amount', typed.value);
      url.searchParams.set('side', typed.side);
    } else {
      url.searchParams.delete('amount');
      url.searchParams.delete('side');
    }
    window.history.replaceState(window.history.state, '', url.toString());
  }, [tokenIn, tokenOut, typed]);

  return null;
}
