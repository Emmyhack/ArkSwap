'use client';

import {createContext, useContext, useMemo, useState} from 'react';

import {KASH, MUSDC, type Token} from '@/config/tokens';

/**
 * Swap token selection, lifted out of SwapCard so the nav search can drive it.
 *
 * Picking a token from the global search sets the "Buy" side and sends the user
 * to /swap, which is why this lives above the route rather than inside the card.
 */
type SwapState = {
  tokenIn: Token;
  tokenOut: Token;
  setTokenIn: (t: Token) => void;
  setTokenOut: (t: Token) => void;
  flip: () => void;
};

const Ctx = createContext<SwapState | null>(null);

export function SwapProvider({children}: {children: React.ReactNode}) {
  const [tokenIn, setTokenIn] = useState<Token>(KASH);
  const [tokenOut, setTokenOut] = useState<Token>(MUSDC ?? KASH);

  const value = useMemo<SwapState>(
    () => ({
      tokenIn,
      tokenOut,
      setTokenIn,
      setTokenOut,
      flip: () => {
        setTokenIn(tokenOut);
        setTokenOut(tokenIn);
      },
    }),
    [tokenIn, tokenOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSwapTokens(): SwapState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSwapTokens must be used inside SwapProvider');
  return v;
}
