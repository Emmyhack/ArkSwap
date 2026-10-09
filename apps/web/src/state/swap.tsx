'use client';

import {createContext, useContext, useMemo, useState} from 'react';

import {KASH, MUSDC, type Token} from '@/config/tokens';

/**
 * Swap form state, lifted out of SwapCard so the nav search and a shared URL
 * can drive it.
 *
 * `typed` records which side the user last edited and what they typed: the
 * "Sell" side gives an exact-input swap, the "Buy" side an exact-output one.
 * The other side is always derived from the route.
 */
export type SwapSide = 'in' | 'out';

export type Typed = {side: SwapSide; value: string};

type SwapState = {
  tokenIn: Token;
  tokenOut: Token;
  typed: Typed;
  setTokenIn: (t: Token) => void;
  setTokenOut: (t: Token) => void;
  setTyped: (t: Typed) => void;
  flip: () => void;
};

const Ctx = createContext<SwapState | null>(null);

export function SwapProvider({children}: {children: React.ReactNode}) {
  const [tokenIn, setTokenIn] = useState<Token>(KASH);
  const [tokenOut, setTokenOut] = useState<Token>(MUSDC ?? KASH);
  const [typed, setTyped] = useState<Typed>({side: 'in', value: ''});

  const value = useMemo<SwapState>(
    () => ({
      tokenIn,
      tokenOut,
      typed,
      setTokenIn,
      setTokenOut,
      setTyped,
      flip: () => {
        setTokenIn(tokenOut);
        setTokenOut(tokenIn);
        // What was typed follows its token to the other side, so flipping a
        // "sell 10 KASH" becomes "buy 10 KASH".
        setTyped((t) => ({side: t.side === 'in' ? 'out' : 'in', value: t.value}));
      },
    }),
    [tokenIn, tokenOut, typed],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSwapTokens(): SwapState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSwapTokens must be used inside SwapProvider');
  return v;
}
