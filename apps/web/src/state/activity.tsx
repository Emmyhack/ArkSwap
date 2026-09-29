'use client';

import {useQueryClient} from '@tanstack/react-query';
import {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import type {Address, Hex} from 'viem';
import {useAccount, useWaitForTransactionReceipt} from 'wagmi';

import {ARK_CHAIN_ID} from '@/config/chain';
import {readJson, writeJson} from '@/lib/storage';

/**
 * Per-wallet transaction activity.
 *
 * Every transaction the app sends is recorded here the moment the wallet
 * returns a hash, then watched until it lands. The list is display only and
 * lives in this browser: it never authorises anything and nothing on a
 * transaction path reads from it (llm.txt s36). Once a receipt arrives every
 * cached read is invalidated so balances, reserves and allowances refresh
 * without each form having to know what changed.
 */
export type ActivityKind = 'swap' | 'approve' | 'add' | 'remove' | 'mint';
export type ActivityStatus = 'pending' | 'confirmed' | 'failed';

export type ActivityItem = {
  hash: Hex;
  kind: ActivityKind;
  summary: string;
  status: ActivityStatus;
  createdAt: number;
  account: Address;
};

type ActivityState = {
  /** Items for the connected account, newest first. */
  items: ActivityItem[];
  pendingCount: number;
  track: (item: {hash: Hex; kind: ActivityKind; summary: string}) => void;
  clear: () => void;
};

const KEY = `arkswap.activity.${ARK_CHAIN_ID}`;
const MAX_ITEMS = 60;

const Ctx = createContext<ActivityState | null>(null);

export function ActivityProvider({children}: {children: React.ReactNode}) {
  const {address} = useAccount();
  const [all, setAll] = useState<ActivityItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const raw = readJson<ActivityItem[]>(KEY, []);
    setAll(Array.isArray(raw) ? raw.filter((i) => typeof i?.hash === 'string') : []);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) writeJson(KEY, all.slice(0, MAX_ITEMS));
  }, [all, hydrated]);

  const track = useCallback(
    (item: {hash: Hex; kind: ActivityKind; summary: string}) => {
      if (!address) return;
      setAll((prev) => {
        if (prev.some((p) => p.hash.toLowerCase() === item.hash.toLowerCase())) return prev;
        const next: ActivityItem = {...item, status: 'pending', createdAt: Date.now(), account: address};
        return [next, ...prev].slice(0, MAX_ITEMS);
      });
    },
    [address],
  );

  const settle = useCallback((hash: Hex, status: ActivityStatus) => {
    setAll((prev) => prev.map((p) => (p.hash.toLowerCase() === hash.toLowerCase() ? {...p, status} : p)));
  }, []);

  const clear = useCallback(() => {
    setAll((prev) => prev.filter((p) => p.status === 'pending'));
  }, []);

  const items = useMemo(
    () => (address ? all.filter((i) => i.account.toLowerCase() === address.toLowerCase()) : []),
    [all, address],
  );

  const pending = useMemo(() => all.filter((i) => i.status === 'pending'), [all]);

  const value = useMemo<ActivityState>(
    () => ({items, pendingCount: items.filter((i) => i.status === 'pending').length, track, clear}),
    [items, track, clear],
  );

  return (
    <Ctx.Provider value={value}>
      {pending.map((p) => (
        <PendingWatcher key={p.hash} hash={p.hash} onSettle={settle} />
      ))}
      {children}
    </Ctx.Provider>
  );
}

/** One receipt subscription per pending hash; unmounts once it settles. */
function PendingWatcher({hash, onSettle}: {hash: Hex; onSettle: (hash: Hex, status: ActivityStatus) => void}) {
  const receipt = useWaitForTransactionReceipt({hash});
  const queryClient = useQueryClient();

  useEffect(() => {
    if (receipt.isSuccess) {
      onSettle(hash, receipt.data?.status === 'reverted' ? 'failed' : 'confirmed');
      queryClient.invalidateQueries();
    } else if (receipt.isError) {
      onSettle(hash, 'failed');
    }
  }, [receipt.isSuccess, receipt.isError, receipt.data?.status, hash, onSettle, queryClient]);

  return null;
}

export function useActivity(): ActivityState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useActivity must be used inside ActivityProvider');
  return v;
}
