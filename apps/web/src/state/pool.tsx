'use client';

import {createContext, useContext, useMemo, useState} from 'react';

import {KASH, MUSDC, type Token} from '@/config/tokens';

/**
 * Liquidity form selection, lifted so the positions list and a shared URL can
 * point the form at a pair.
 */
export type PoolMode = 'add' | 'remove';

type PoolState = {
  tokenA: Token;
  tokenB: Token;
  mode: PoolMode;
  setTokenA: (t: Token) => void;
  setTokenB: (t: Token) => void;
  setMode: (m: PoolMode) => void;
  select: (a: Token, b: Token, mode?: PoolMode) => void;
};

const Ctx = createContext<PoolState | null>(null);

export function PoolProvider({children}: {children: React.ReactNode}) {
  const [tokenA, setTokenA] = useState<Token>(KASH);
  const [tokenB, setTokenB] = useState<Token>(MUSDC ?? KASH);
  const [mode, setMode] = useState<PoolMode>('add');

  const value = useMemo<PoolState>(
    () => ({
      tokenA,
      tokenB,
      mode,
      setTokenA,
      setTokenB,
      setMode,
      select: (a, b, m) => {
        setTokenA(a);
        setTokenB(b);
        if (m) setMode(m);
      },
    }),
    [tokenA, tokenB, mode],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePoolSelection(): PoolState {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePoolSelection must be used inside PoolProvider');
  return v;
}
