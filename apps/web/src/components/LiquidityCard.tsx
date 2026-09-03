'use client';

import {useEffect, useMemo, useState} from 'react';
import {useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract} from 'wagmi';

import {pairAbi, routerAbi} from '@/config/abis';
import {explorerAddressUrl, explorerTxUrl} from '@/config/chain';
import {ARKSWAP_ROUTER_ADDRESS} from '@/config/contracts';
import {KASH, MUSDC, type Token, routedAddress, sameToken} from '@/config/tokens';
import {useAllowance} from '@/hooks/useAllowance';
import {usePoolState} from '@/hooks/usePoolState';
import {useTokenBalance} from '@/hooks/useTokenBalance';
import {BPS, deadlineFromNow, quote as quoteAmount} from '@/lib/amm';
import {formatAmount, formatBps, parseAmount, shortenAddress} from '@/lib/format';
import {orientReserves, poolShareBps} from '@/lib/pools';

import {AmountField} from './AmountField';
import {SettingsPopover} from './SettingsPopover';

type Mode = 'add' | 'remove';

export function LiquidityCard() {
  const {address, isConnected} = useAccount();

  const [mode, setMode] = useState<Mode>('add');
  const [tokenA, setTokenA] = useState<Token>(KASH);
  const [tokenB, setTokenB] = useState<Token>(MUSDC ?? KASH);
  const [inputA, setInputA] = useState('');
  const [removePercent, setRemovePercent] = useState(50);
  const [slippageBps, setSlippageBps] = useState(50n);
  const [deadlineMinutes, setDeadlineMinutes] = useState(20);

  const {pool, derivationMismatch, refetch} = usePoolState(tokenA, tokenB);
  const balanceA = useTokenBalance(tokenA);
  const balanceB = useTokenBalance(tokenB);

  const lpBalance = useReadContract({
    address: pool?.pair,
    abi: pairAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {enabled: Boolean(pool && address), refetchInterval: 12_000},
  });

  const amountA = useMemo(() => parseAmount(inputA, tokenA.decimals), [inputA, tokenA.decimals]);

  /** Matching B amount at the current pool ratio, mirroring Router `_addLiquidity`. */
  const amountB = useMemo(() => {
    if (!pool || amountA === null || amountA <= 0n) return undefined;
    const routed = routedAddress(tokenA);
    if (!routed) return undefined;
    const {reserveIn, reserveOut} = orientReserves(pool, routed);
    if (reserveIn <= 0n || reserveOut <= 0n) return undefined;
    try {
      return quoteAmount(amountA, reserveIn, reserveOut);
    } catch {
      return undefined;
    }
  }, [pool, amountA, tokenA]);

  const allowanceA = useAllowance(tokenA, amountA ?? undefined);
  const allowanceB = useAllowance(tokenB, amountB);

  /**
   * Reserves oriented to the tokens the user picked, each carrying its own
   * decimals. Reading reserve0/reserve1 positionally and assuming which side is
   * 18- vs 6-decimal is wrong for any pair whose sort order differs (and for
   * mUSDC/mUSDT, where both sides are 6).
   */
  const reserves = useMemo(() => {
    if (!pool) return undefined;
    const routed = routedAddress(tokenA);
    if (!routed) return undefined;
    const {reserveIn, reserveOut} = orientReserves(pool, routed);
    return {a: reserveIn, b: reserveOut};
  }, [pool, tokenA]);

  const lp = (lpBalance.data as bigint | undefined) ?? 0n;
  const removeAmount = (lp * BigInt(removePercent)) / 100n;

  const {writeContract, data: hash, isPending, error, reset} = useWriteContract();
  const receipt = useWaitForTransactionReceipt({hash});

  useEffect(() => {
    if (receipt.isSuccess) {
      setInputA('');
      refetch();
      lpBalance.refetch();
      balanceA.refetch();
      balanceB.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);

  function withSlippage(value: bigint): bigint {
    return (value * (BPS - slippageBps)) / BPS;
  }

  function addLiquidity() {
    if (!ARKSWAP_ROUTER_ADDRESS || !address || amountA === null || amountA <= 0n) return;
    const deadline = deadlineFromNow(deadlineMinutes);

    // First deposit into an empty pool sets the price, so there is no ratio to
    // slip against; every later deposit is protected (llm.txt s32, s43).
    const isFirstDeposit = !pool;
    const bAmount = amountB ?? parseAmount(inputA, tokenB.decimals) ?? 0n;

    const nativeSide = tokenA.isNative ? 'A' : tokenB.isNative ? 'B' : undefined;

    if (nativeSide) {
      const token = nativeSide === 'A' ? tokenB : tokenA;
      const tokenAmount = nativeSide === 'A' ? bAmount : amountA;
      const kashAmount = nativeSide === 'A' ? amountA : bAmount;
      if (!token.address) return;

      writeContract({
        address: ARKSWAP_ROUTER_ADDRESS,
        abi: routerAbi,
        functionName: 'addLiquidityETH', // adds native KASH (llm.txt s41)
        args: [
          token.address,
          tokenAmount,
          isFirstDeposit ? 0n : withSlippage(tokenAmount),
          isFirstDeposit ? 0n : withSlippage(kashAmount),
          address,
          deadline,
        ],
        value: kashAmount,
      });
      return;
    }

    if (!tokenA.address || !tokenB.address) return;
    writeContract({
      address: ARKSWAP_ROUTER_ADDRESS,
      abi: routerAbi,
      functionName: 'addLiquidity',
      args: [
        tokenA.address,
        tokenB.address,
        amountA,
        bAmount,
        isFirstDeposit ? 0n : withSlippage(amountA),
        isFirstDeposit ? 0n : withSlippage(bAmount),
        address,
        deadline,
      ],
    });
  }

  function approveLp() {
    if (!pool || !ARKSWAP_ROUTER_ADDRESS) return;
    writeContract({
      address: pool.pair,
      abi: pairAbi,
      functionName: 'approve',
      args: [ARKSWAP_ROUTER_ADDRESS, removeAmount],
    });
  }

  function removeLiquidity() {
    if (!ARKSWAP_ROUTER_ADDRESS || !address || !pool || removeAmount <= 0n) return;
    const deadline = deadlineFromNow(deadlineMinutes);

    const share = pool.totalSupply > 0n ? removeAmount : 0n;
    const routedA = routedAddress(tokenA);
    if (!routedA) return;
    const {reserveIn, reserveOut} = orientReserves(pool, routedA);
    const expectedA = pool.totalSupply > 0n ? (share * reserveIn) / pool.totalSupply : 0n;
    const expectedB = pool.totalSupply > 0n ? (share * reserveOut) / pool.totalSupply : 0n;

    const nativeSide = tokenA.isNative ? 'A' : tokenB.isNative ? 'B' : undefined;

    if (nativeSide) {
      const token = nativeSide === 'A' ? tokenB : tokenA;
      const tokenMin = nativeSide === 'A' ? expectedB : expectedA;
      const kashMin = nativeSide === 'A' ? expectedA : expectedB;
      if (!token.address) return;

      writeContract({
        address: ARKSWAP_ROUTER_ADDRESS,
        abi: routerAbi,
        functionName: 'removeLiquidityETH', // returns native KASH
        args: [token.address, removeAmount, withSlippage(tokenMin), withSlippage(kashMin), address, deadline],
      });
      return;
    }

    if (!tokenA.address || !tokenB.address) return;
    writeContract({
      address: ARKSWAP_ROUTER_ADDRESS,
      abi: routerAbi,
      functionName: 'removeLiquidity',
      args: [
        tokenA.address,
        tokenB.address,
        removeAmount,
        withSlippage(expectedA),
        withSlippage(expectedB),
        address,
        deadline,
      ],
    });
  }

  const needsApproval = mode === 'add' && (allowanceA.needsApproval || allowanceB.needsApproval);

  return (
    <div className="card">
      <div className="card__header">
        <h2 className="card__title">{mode === 'add' ? 'Add liquidity' : 'Remove liquidity'}</h2>
        <div style={{display: 'flex', gap: 6, alignItems: 'center'}}>
          <SettingsPopover
            slippageBps={slippageBps}
            onSlippageChange={setSlippageBps}
            deadlineMinutes={deadlineMinutes}
            onDeadlineChange={setDeadlineMinutes}
          />
          <button
            type="button"
            className="settings__chip"
            data-active={mode === 'add'}
            onClick={() => {
              setMode('add');
              reset();
            }}
          >
            Add
          </button>
          <button
            type="button"
            className="settings__chip"
            data-active={mode === 'remove'}
            onClick={() => {
              setMode('remove');
              reset();
            }}
          >
            Remove
          </button>
        </div>
      </div>

      {mode === 'add' ? (
        <>
          <AmountField
            label="Deposit"
            token={tokenA}
            exclude={tokenB}
            value={inputA}
            balance={balanceA.value}
            onValueChange={setInputA}
            onTokenChange={setTokenA}
          />

          <div className="switch">
            <button type="button" data-static="true" aria-hidden tabIndex={-1}>
              +
            </button>
          </div>

          <AmountField
            label={pool ? 'Deposit (at pool ratio)' : 'Deposit (you set the initial price)'}
            token={tokenB}
            exclude={tokenA}
            readOnly={Boolean(pool)}
            value={pool ? (amountB !== undefined ? formatAmount(amountB, tokenB.decimals) : '') : inputA}
            balance={balanceB.value}
            onValueChange={() => {}}
            onTokenChange={setTokenB}
          />
        </>
      ) : (
        <div className="field">
          <div className="field__label">Amount to remove</div>
          <div className="field__row">
            <span className="field__input mono" style={{fontSize: 40}}>
              {removePercent}%
            </span>
          </div>
          <input
            className="range"
            type="range"
            min={1}
            max={100}
            value={removePercent}
            onChange={(e) => setRemovePercent(Number(e.target.value))}
            aria-label="Percent of position to remove"
          />
          <div className="field__foot">
            <span>LP balance</span>
            <span className="mono">{formatAmount(lp, 18)}</span>
          </div>
        </div>
      )}


      {pool && (
        <div className="details">
          <div className="details__row">
            <span>Pool</span>
            <strong>
              {explorerAddressUrl(pool.pair) ? (
                <a href={explorerAddressUrl(pool.pair)} target="_blank" rel="noreferrer">
                  {shortenAddress(pool.pair)} ↗
                </a>
              ) : (
                shortenAddress(pool.pair)
              )}
            </strong>
          </div>
          <div className="details__row">
            <span>Your pool share</span>
            <strong className="mono">{formatBps(poolShareBps(lp, pool.totalSupply))}</strong>
          </div>
          <div className="details__row">
            <span>Reserves</span>
            <strong className="mono">
              {reserves
                ? `${formatAmount(reserves.a, tokenA.decimals)} ${tokenA.symbol} / ` +
                  `${formatAmount(reserves.b, tokenB.decimals)} ${tokenB.symbol}`
                : '—'}
            </strong>
          </div>
        </div>
      )}

      {!pool && (
        <div className="alert alert--info">
          No pool exists for this pair yet. Your deposit creates it and sets the initial price.
        </div>
      )}

      {derivationMismatch && (
        <div className="alert alert--danger">
          Derived pair address does not match the factory. <code>PAIR_INIT_CODE_HASH</code> is wrong
          for this deployment.
        </div>
      )}

      {error && <div className="alert alert--danger">{error.message.slice(0, 200)}</div>}

      {receipt.isSuccess && hash && (
        <div className="alert alert--accent">
          Confirmed.{' '}
          {explorerTxUrl(hash) ? (
            <a href={explorerTxUrl(hash)} target="_blank" rel="noreferrer">
              View on Blockscout ↗
            </a>
          ) : (
            <span className="mono">{hash}</span>
          )}
        </div>
      )}

      {mode === 'add' ? (
        <>
          {allowanceA.needsApproval && (
            <button className="btn btn--sm" type="button" onClick={() => allowanceA.approve()}>
              {allowanceA.isApproving ? 'Approving…' : `Approve ${tokenA.symbol}`}
            </button>
          )}
          {allowanceB.needsApproval && (
            <button className="btn btn--sm" type="button" onClick={() => allowanceB.approve()}>
              {allowanceB.isApproving ? 'Approving…' : `Approve ${tokenB.symbol}`}
            </button>
          )}
          <button
            className="btn btn--primary"
            type="button"
            disabled={
              !isConnected ||
              needsApproval ||
              sameToken(tokenA, tokenB) ||
              amountA === null ||
              amountA <= 0n ||
              isPending ||
              receipt.isLoading
            }
            onClick={addLiquidity}
          >
            {!isConnected ? 'Connect wallet' : isPending || receipt.isLoading ? 'Adding…' : 'Add liquidity'}
          </button>
        </>
      ) : (
        <>
          <button className="btn btn--sm" type="button" disabled={!pool} onClick={approveLp}>
            Approve LP tokens
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!isConnected || !pool || removeAmount <= 0n || isPending || receipt.isLoading}
            onClick={removeLiquidity}
          >
            {isPending || receipt.isLoading ? 'Removing…' : 'Remove liquidity'}
          </button>
        </>
      )}
    </div>
  );
}
