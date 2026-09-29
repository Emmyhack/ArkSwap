'use client';

import {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import {type Address, getAddress, isAddress} from 'viem';

import {ARK_CHAIN_ID} from '@/config/chain';
import {TOKEN_LIST, type Token, tokenByAddress} from '@/config/tokens';
import {readJson, writeJson} from '@/lib/storage';

/**
 * User-imported tokens.
 *
 * The manifest is the reviewed allowlist; anything imported here has had its
 * name, symbol and decimals read from the contract and nothing else checked.
 * Imports are per chain, per browser, and are rendered with an "unverified"
 * badge wherever a token appears (llm.txt s48). They never override a listed
 * token: an import that collides with a manifest address is dropped.
 */
export const IMPORTED_WARNING = 'Imported by address — not reviewed by ArkSwap.';

type Stored = {address: Address; symbol: string; name: string; decimals: number};

type TokensState = {
  /** Manifest tokens followed by imports. */
  tokens: Token[];
  imported: Token[];
  importToken: (t: Stored) => Token;
  removeToken: (address: Address) => void;
  isImported: (address: string | undefined) => boolean;
};

const KEY = `arkswap.customTokens.${ARK_CHAIN_ID}`;

const Ctx = createContext<TokensState | null>(null);

function toToken(s: Stored): Token {
  return {
    address: getAddress(s.address),
    symbol: s.symbol,
    name: s.name,
    decimals: s.decimals,
    isImported: true,
    warning: IMPORTED_WARNING,
  };
}

function valid(s: unknown): s is Stored {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.address === 'string' &&
    isAddress(o.address) &&
    typeof o.symbol === 'string' &&
    typeof o.name === 'string' &&
    typeof o.decimals === 'number' &&
    Number.isInteger(o.decimals) &&
    o.decimals >= 0 &&
    o.decimals <= 36
  );
}

export function TokensProvider({children}: {children: React.ReactNode}) {
  const [stored, setStored] = useState<Stored[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const raw = readJson<unknown[]>(KEY, []);
    const clean = (Array.isArray(raw) ? raw : []).filter(valid);
    setStored(clean.filter((s) => !tokenByAddress(TOKEN_LIST, s.address)));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) writeJson(KEY, stored);
  }, [stored, hydrated]);

  const imported = useMemo(() => stored.map(toToken), [stored]);
  const tokens = useMemo(() => [...TOKEN_LIST, ...imported], [imported]);

  const importToken = useCallback((s: Stored): Token => {
    const listed = tokenByAddress(TOKEN_LIST, s.address);
    if (listed) return listed;
    setStored((prev) => {
      if (prev.some((p) => p.address.toLowerCase() === s.address.toLowerCase())) return prev;
      return [...prev, {...s, address: getAddress(s.address)}];
    });
    return toToken(s);
  }, []);

  const removeToken = useCallback((address: Address) => {
    setStored((prev) => prev.filter((p) => p.address.toLowerCase() !== address.toLowerCase()));
  }, []);

  const value = useMemo<TokensState>(
    () => ({
      tokens,
      imported,
      importToken,
      removeToken,
      isImported: (address) =>
        Boolean(address && imported.some((t) => t.address?.toLowerCase() === address.toLowerCase())),
    }),
    [tokens, imported, importToken, removeToken],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTokens(): TokensState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTokens must be used inside TokensProvider');
  return v;
}

/** The full selectable list: manifest tokens plus this browser's imports. */
export function useTokenList(): Token[] {
  return useTokens().tokens;
}
