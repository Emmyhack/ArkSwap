'use client';

import {useEffect, useMemo, useState} from 'react';
import {useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract} from 'wagmi';

import {pairAbi, routerAbi} from '@/config/abis';
import {explorerAddressUrl, explorerTxUrl} from '@/config/chain';
import {ARKSWAP_ROUTER_ADDRESS} from '@/config/contracts';
import {type Token, routedAddress, sameToken} from '@/config/tokens';
import {useAllowance} from '@/hooks/useAllowance';
import {useLpPermit} from '@/hooks/useLpPermit';
import {usePoolState} from '@/hooks/usePoolState';
import {useTokenBalance} from '@/hooks/useTokenBalance';
import {BPS, deadlineFromNow, quote as quoteAmount} from '@/lib/amm';
import {formatAmount, formatBps, parseAmount, shortenAddress} from '@/lib/format';
import {orientReserves, poolShareBps} from '@/lib/pools';
import {useActivity} from '@/state/activity';
import {usePoolSelection} from '@/state/pool';
import {useSettings} from '@/state/settings';

import {AmountField} from './AmountField';
import {SettingsPopover} from './SettingsPopover';
import {Skeleton} from './Skeleton';

export function LiquidityCard() {
  const {address, isConnected} = useAccount();
  const {tokenA, tokenB, mode, setTokenA, setTokenB, setMode} = usePoolSelection();
  const {slippageBps, deadlineMinutes, feeOnTransfer} = useSettings();
  const {track} = useActivity();

  const [inputA, setInputA] = useState('');
  const [removePercent, setRemovePercent] = useState(50);
  // Set once a wallet declines or cannot produce a permit signature; the form
  // then falls back to the classic approve-then-remove flow.
  const [permitFallback, setPermitFallback] = useState(false);

  const {pool, derivationMismatch, isLoading: poolLoading, refetch} = usePoolState(tokenA, tokenB);
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

  // The LP token is an ERC-20 like any other for approval purposes.
  const lpToken = useMemo<Token | undefined>(
    () => (pool ? {address: pool.pair, symbol: 'ArkSwap-LP', name: 'ArkSwap LP token', decimals: 18} : undefined),
    [pool],
  );
  const lpAllowance = useAllowance(lpToken, removeAmount > 0n ? removeAmount : undefined);
  const permit = useLpPermit(pool?.pair);

  const {writeContract, data: hash, isPending, error, reset} = useWriteContract();
  const receipt = useWaitForTransactionReceipt({hash});

  useEffect(() => {
    if (receipt.isSuccess) {
      setInputA('');
      refetch();
      lpBalance.refetch();
      balanceA.refetch();
      balanceB.refetch();
      permit.refetchNonce();
      lpAllowance.refetchAllowance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);

  function withSlippage(value: bigint): bigint {
    return (value * (BPS - slippageBps)) / BPS;
  }

  function expectedOut() {
    if (!pool || pool.totalSupply === 0n) return {a: 0n, b: 0n};
    const routedA = routedAddress(tokenA);
    if (!routedA) return {a: 0n, b: 0n};
    const {reserveIn, reserveOut} = orientReserves(pool, routedA);
    return {a: (removeAmount * reserveIn) / pool.totalSupply, b: (removeAmount * reserveOut) / pool.totalSupply};
  }

  const expected = expectedOut();

  function addLiquidity() {
    if (!ARKSWAP_ROUTER_ADDRESS || !address || amountA === null || amountA <= 0n) return;
    const deadline = deadlineFromNow(deadlineMinutes);

    // First deposit into an empty pool sets the price, so there is no ratio to
    // slip against; every later deposit is protected (llm.txt s32, s43).
    const isFirstDeposit = !pool;
    const bAmount = amountB ?? parseAmount(inputA, tokenB.decimals) ?? 0n;
    const onSuccess = (txHash: `0x${string}`) =>
      track({
        hash: txHash,
        kind: 'add',
        summary: `Add ${formatAmount(amountA, tokenA.decimals, 4)} ${tokenA.symbol} + ${formatAmount(bAmount, tokenB.decimals, 4)} ${tokenB.symbol}`,
      });

    const nativeSide = tokenA.isNative ? 'A' : tokenB.isNative ? 'B' : undefined;

    if (nativeSide) {
      const token = nativeSide === 'A' ? tokenB : tokenA;
      const tokenAmount = nativeSide === 'A' ? bAmount : amountA;
      const kashAmount = nativeSide === 'A' ? amountA : bAmount;
      if (!token.address) return;

      writeContract(
        {
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
        },
        {onSuccess},
      );
      return;
    }

    if (!tokenA.address || !tokenB.address) return;
    writeContract(
      {
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
      },
      {onSuccess},
    );
  }

  /**
   * Removal. With a permit the whole thing is one signature plus one
   * transaction; if the wallet cannot sign typed data the form falls back to
   * approve-then-remove. Either way the LP amount is read from the chain at
   * submit time, never from analytics (llm.txt s36).
   */
  async function removeLiquidity() {
    if (!ARKSWAP_ROUTER_ADDRESS || !address || !pool || removeAmount <= 0n) return;
    const deadline = deadlineFromNow(deadlineMinutes);
    const nativeSide = tokenA.isNative ? 'A' : tokenB.isNative ? 'B' : undefined;
    const onSuccess = (txHash: `0x${string}`) =>
      track({
        hash: txHash,
        kind: 'remove',
        summary: `Remove ${removePercent}% of ${tokenA.symbol}/${tokenB.symbol} liquidity`,
      });

    const usePermit = lpAllowance.needsApproval && !permitFallback;
    let sig: Awaited<ReturnType<typeof permit.sign>> | undefined;
    if (usePermit) {
      sig = await permit.sign(removeAmount, deadline);
      if (!sig) {
        setPermitFallback(true);
        return;
      }
    } else if (lpAllowance.needsApproval) {
      return; // the approve button is showing
    }

    if (nativeSide) {
      const token = nativeSide === 'A' ? tokenB : tokenA;
      const tokenMin = withSlippage(nativeSide === 'A' ? expected.b : expected.a);
      const kashMin = withSlippage(nativeSide === 'A' ? expected.a : expected.b);
      if (!token.address) return;

      if (sig) {
        writeContract(
          {
            address: ARKSWAP_ROUTER_ADDRESS,
            abi: routerAbi,
            functionName: feeOnTransfer
              ? 'removeLiquidityETHWithPermitSupportingFeeOnTransferTokens'
              : 'removeLiquidityETHWithPermit', // returns native KASH
            args: [token.address, removeAmount, tokenMin, kashMin, address, deadline, false, sig.v, sig.r, sig.s],
          },
          {onSuccess},
        );
      } else {
        writeContract(
          {
            address: ARKSWAP_ROUTER_ADDRESS,
            abi: routerAbi,
            functionName: feeOnTransfer ? 'removeLiquidityETHSupportingFeeOnTransferTokens' : 'removeLiquidityETH',
            args: [token.address, removeAmount, tokenMin, kashMin, address, deadline],
          },
          {onSuccess},
        );
      }
      return;
    }

    if (!tokenA.address || !tokenB.address) return;
    const minA = withSlippage(expected.a);
    const minB = withSlippage(expected.b);
    if (sig) {
      writeContract(
        {
          address: ARKSWAP_ROUTER_ADDRESS,
          abi: routerAbi,
          functionName: 'removeLiquidityWithPermit',
          args: [tokenA.address, tokenB.address, removeAmount, minA, minB, address, deadline, false, sig.v, sig.r, sig.s],
        },
        {onSuccess},
      );
    } else {
      writeContract(
        {
          address: ARKSWAP_ROUTER_ADDRESS,
          abi: routerAbi,
          functionName: 'removeLiquidity',
          args: [tokenA.address, tokenB.address, removeAmount, minA, minB, address, deadline],
        },
        {onSuccess},
      );
    }
  }

  const needsApproval = mode === 'add' && (allowanceA.needsApproval || allowanceB.needsApproval);
  const busy = isPending || receipt.isLoading;
  const removeNeedsApproveTx = mode === 'remove' && lpAllowance.needsApproval && permitFallback;

  return (
    <div className="card">
      <div className="card__header">
        <h2 className="card__title">{mode === 'add' ? 'Add liquidity' : 'Remove liquidity'}</h2>
        <div style={{display: 'flex', gap: 6, alignItems: 'center'}}>
          <SettingsPopover />
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
            balanceLoading={balanceA.isLoading}
            onValueChange={setInputA}
            onTokenChange={setTokenA}
          />

          <div className="switch">
            <button type="button" data-static="true" aria-hidden tabIndex={-1}>
              +
            </button>
          </div>

          <AmountField
            label={pool ? 'Deposit (at pool ratio)' : poolLoading ? 'Deposit' : 'Deposit (you set the initial price)'}
            token={tokenB}
            exclude={tokenA}
            readOnly={Boolean(pool)}
            loading={Boolean(pool) && amountA !== null && amountA > 0n && amountB === undefined}
            value={pool ? (amountB !== undefined ? formatAmount(amountB, tokenB.decimals) : '') : inputA}
            balance={balanceB.value}
            balanceLoading={balanceB.isLoading}
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
            <div className="settings" style={{gap: 4}}>
              {[25, 50, 75, 100].map((p) => (
                <button
                  key={p}
                  type="button"
                  className="settings__chip"
                  data-active={removePercent === p}
                  onClick={() => setRemovePercent(p)}
                >
                  {p === 100 ? 'Max' : `${p}%`}
                </button>
              ))}
            </div>
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
            <span>
              {tokenA.symbol}/{tokenB.symbol} LP balance
            </span>
            {lpBalance.isLoading ? <Skeleton width={80} height={12} /> : <span className="mono">{formatAmount(lp, 18)}</span>}
          </div>
        </div>
      )}

      {mode === 'remove' && pool && removeAmount > 0n && (
        <div className="details">
          <div className="details__row">
            <span>You receive (est.)</span>
            <strong className="mono">
              {formatAmount(expected.a, tokenA.decimals)} {tokenA.symbol} + {formatAmount(expected.b, tokenB.decimals)}{' '}
              {tokenB.symbol}
            </strong>
          </div>
          <div className="details__row">
            <span>Minimum after slippage</span>
            <strong className="mono">
              {formatAmount(withSlippage(expected.a), tokenA.decimals)} / {formatAmount(withSlippage(expected.b), tokenB.decimals)}
            </strong>
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

      {!pool && poolLoading && (
        <div className="details">
          <div className="details__row">
            <Skeleton width={60} />
            <Skeleton width={120} />
          </div>
          <div className="details__row">
            <Skeleton width={90} />
            <Skeleton width={160} />
          </div>
        </div>
      )}

      {!pool && !poolLoading && (
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

      {mode === 'remove' && permit.error && !permitFallback && (
        <div className="alert alert--danger">{permit.error.message.slice(0, 200)}</div>
      )}
      {mode === 'remove' && permitFallback && lpAllowance.needsApproval && (
        <div className="alert alert--info">
          Your wallet did not sign the permit, so removal needs a separate approval transaction first.{' '}
          <button type="button" className="field__max" onClick={() => setPermitFallback(false)}>
            Try the signature again
          </button>
        </div>
      )}

      {error && <div className="alert alert--danger">{error.message.slice(0, 200)}</div>}
      {allowanceA.approvalError && <div className="alert alert--danger">{allowanceA.approvalError.message.slice(0, 200)}</div>}
      {allowanceB.approvalError && <div className="alert alert--danger">{allowanceB.approvalError.message.slice(0, 200)}</div>}
      {lpAllowance.approvalError && <div className="alert alert--danger">{lpAllowance.approvalError.message.slice(0, 200)}</div>}

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
            <button className="btn btn--sm" type="button" disabled={allowanceA.isApproving} onClick={() => allowanceA.approve()}>
              {allowanceA.isApproving ? 'Approving…' : `Approve ${tokenA.symbol}`}
            </button>
          )}
          {allowanceB.needsApproval && (
            <button className="btn btn--sm" type="button" disabled={allowanceB.isApproving} onClick={() => allowanceB.approve()}>
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
              busy
            }
            onClick={addLiquidity}
          >
            {!isConnected ? 'Connect wallet' : busy ? 'Adding…' : 'Add liquidity'}
          </button>
        </>
      ) : (
        <>
          {removeNeedsApproveTx && (
            <button className="btn btn--sm" type="button" disabled={lpAllowance.isApproving} onClick={() => lpAllowance.approve()}>
              {lpAllowance.isApproving ? 'Approving…' : 'Approve LP tokens'}
            </button>
          )}
          <button
            className="btn btn--primary"
            type="button"
            disabled={
              !isConnected ||
              !pool ||
              removeAmount <= 0n ||
              busy ||
              permit.isSigning ||
              removeNeedsApproveTx ||
              (lpAllowance.needsApproval && !permit.ready && !permitFallback)
            }
            onClick={removeLiquidity}
          >
            {!isConnected
              ? 'Connect wallet'
              : permit.isSigning
                ? 'Sign in your wallet…'
                : busy
                  ? 'Removing…'
                  : lpAllowance.needsApproval && !permitFallback
                    ? 'Sign & remove liquidity'
                    : 'Remove liquidity'}
          </button>
          {lpAllowance.needsApproval && !permitFallback && pool && removeAmount > 0n && (
            <p className="muted" style={{margin: '10px 8px 2px', fontSize: 12.5, textAlign: 'center'}}>
              One signature, one transaction: the LP approval is carried inside the removal via permit.
            </p>
          )}
        </>
      )}
    </div>
  );
}
