'use client';

import {createContext, useContext, useEffect, useMemo, useState} from 'react';

import {readJson, writeJson} from '@/lib/storage';

/**
 * Transaction settings shared by the swap and liquidity forms.
 *
 * Slippage and deadline are the user's only on-chain protection (llm.txt s43),
 * so they live in one place and persist across visits rather than resetting
 * silently on every page load. Zero slippage is never stored.
 *
 * `feeOnTransfer` switches the router calls to their
 * `SupportingFeeOnTransferTokens` variants, which are the only way a token that
 * takes a cut on transfer can clear the pair's K check. It is off by default:
 * those variants give up exact-output swaps and the pre-flight output check.
 */
export type Settings = {
  slippageBps: bigint;
  deadlineMinutes: number;
  feeOnTransfer: boolean;
};

type SettingsState = Settings & {
  setSlippageBps: (bps: bigint) => void;
  setDeadlineMinutes: (minutes: number) => void;
  setFeeOnTransfer: (on: boolean) => void;
  reset: () => void;
  isDefault: boolean;
};

export const DEFAULT_SETTINGS: Settings = {slippageBps: 50n, deadlineMinutes: 20, feeOnTransfer: false};

const KEY = 'arkswap.settings';

type Stored = {slippageBps: string; deadlineMinutes: number; feeOnTransfer: boolean};

const Ctx = createContext<SettingsState | null>(null);

export function SettingsProvider({children}: {children: React.ReactNode}) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readJson<Stored | null>(KEY, null);
    if (stored) {
      try {
        const bps = BigInt(stored.slippageBps);
        setSettings({
          slippageBps: bps > 0n && bps <= 5000n ? bps : DEFAULT_SETTINGS.slippageBps,
          deadlineMinutes:
            Number.isFinite(stored.deadlineMinutes) && stored.deadlineMinutes > 0 && stored.deadlineMinutes <= 180
              ? stored.deadlineMinutes
              : DEFAULT_SETTINGS.deadlineMinutes,
          feeOnTransfer: Boolean(stored.feeOnTransfer),
        });
      } catch {
        /* corrupt entry: defaults stand */
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const out: Stored = {
      slippageBps: settings.slippageBps.toString(),
      deadlineMinutes: settings.deadlineMinutes,
      feeOnTransfer: settings.feeOnTransfer,
    };
    writeJson(KEY, out);
  }, [settings, hydrated]);

  const value = useMemo<SettingsState>(
    () => ({
      ...settings,
      setSlippageBps: (slippageBps) => setSettings((s) => ({...s, slippageBps})),
      setDeadlineMinutes: (deadlineMinutes) => setSettings((s) => ({...s, deadlineMinutes})),
      setFeeOnTransfer: (feeOnTransfer) => setSettings((s) => ({...s, feeOnTransfer})),
      reset: () => setSettings(DEFAULT_SETTINGS),
      isDefault:
        settings.slippageBps === DEFAULT_SETTINGS.slippageBps &&
        settings.deadlineMinutes === DEFAULT_SETTINGS.deadlineMinutes &&
        settings.feeOnTransfer === DEFAULT_SETTINGS.feeOnTransfer,
    }),
    [settings],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings must be used inside SettingsProvider');
  return v;
}
