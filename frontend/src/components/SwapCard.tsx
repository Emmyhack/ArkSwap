'use client';

import {useEffect, useMemo, useState} from 'react';
import {useAccount, useWaitForTransactionReceipt, useWriteContract} from 'wagmi';

import {routerAbi} from '@/config/abis';
import {explorerTxUrl} from '@/config/chain';
import {ARKSWAP_ROUTER_ADDRESS} from '@/config/contracts';
import {KASH, MUSDC, type Token, routedAddress, sameToken} from '@/config/tokens';
import {useAllowance} from '@/hooks/useAllowance';
import {usePoolState} from '@/hooks/usePoolState';
import {useTokenBalance} from '@/hooks/useTokenBalance';
import {
  LP_FEE_BPS,
  deadlineFromNow,
  getAmountOut,
  impactSeverity,
  minimumReceived,
  priceImpactBps,
} from '@/lib/amm';
import {formatAmount, formatBps, parseAmount} from '@/lib/format';
import {orientReserves} from '@/lib/pools';

import {AmountField} from './AmountField';
import {SlippageControl} from './SlippageControl';

export function SwapCard() {
  const {isConnected, address} = useAccount();

  const [tokenIn, setTokenIn] = useState<Token>(KASH);
  const [tokenOut, setTokenOut] = useState<Token>(MUSDC ?? KASH);
  const [input, setInput] = useState('');
  const [slippageBps, setSlippageBps] = useState(50n);
  const [deadlineMinutes, setDeadlineMinutes] = useState(20);

  const {pool, derivationMismatch, isLoading, refetch} = usePoolState(tokenIn, tokenOut);
  const balanceIn = useTokenBalance(tokenIn);
  const balanceOut = useTokenBalance(tokenOut);

  const amountIn = useMemo(() => parseAmount(input, tokenIn.decimals), [input, tokenIn.decimals]);

  const quote = useMemo(() => {
    if (!pool || amountIn === null || amountIn <= 0n) return undefined;
    const routed = routedAddress(tokenIn);
    if (!routed) return undefined;
    const {reserveIn, reserveOut} = orientReserves(pool, routed);
    if (reserveIn <= 0n || reserveOut <= 0n) return undefined;
    try {
      const amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
      return {
        amountOut,
        minReceived: minimumReceived(amountOut, slippageBps),
        impactBps: priceImpactBps(amountIn, reserveIn, reserveOut),
      };
    } catch {
      return undefined;
    }
  }, [pool, amountIn, tokenIn, slippageBps]);

  const {needsApproval, approve, isApproving, approvalConfirmed, refetchAllowance} = useAllowance(
    tokenIn,
    amountIn ?? undefined,
  );

  useEffect(() => {
    if (approvalConfirmed) refetchAllowance();
  }, [approvalConfirmed, refetchAllowance]);

  const {writeContract, data: hash, isPending, error, reset} = useWriteContract();
  const receipt = useWaitForTransactionReceipt({hash});

  useEffect(() => {
    if (receipt.isSuccess) {
      setInput('');
      refetch();
      balanceIn.refetch();
      balanceOut.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);

  const severity = quote ? impactSeverity(quote.impactBps) : 'none';
  const insufficientBalance =
    amountIn !== null && balanceIn.value !== undefined && amountIn > balanceIn.value;

  function flip() {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setInput('');
    reset();
  }

  function submit() {
    if (!ARKSWAP_ROUTER_ADDRESS || !address || !quote || amountIn === null) return;
    const inAddr = routedAddress(tokenIn);
    const outAddr = routedAddress(tokenOut);
    if (!inAddr || !outAddr) return;

    const path = [inAddr, outAddr] as const;
    const deadline = deadlineFromNow(deadlineMinutes);
    // Execution is always bounded on-chain by amountOutMin -- the local quote is
    // only a display estimate (llm.txt s42).
    const amountOutMin = quote.minReceived;

    if (tokenIn.isNative) {
      writeContract({
        address: ARKSWAP_ROUTER_ADDRESS,
        abi: routerAbi,
        functionName: 'swapExactETHForTokens', // moves native KASH (llm.txt s41)
        args: [amountOutMin, [...path], address, deadline],
        value: amountIn,
      });
    } else if (tokenOut.isNative) {
      writeContract({
        address: ARKSWAP_ROUTER_ADDRESS,
        abi: routerAbi,
        functionName: 'swapExactTokensForETH', // returns native KASH
        args: [amountIn, amountOutMin, [...path], address, deadline],
      });
    } else {
      writeContract({
        address: ARKSWAP_ROUTER_ADDRESS,
        abi: routerAbi,
        functionName: 'swapExactTokensForTokens',
        args: [amountIn, amountOutMin, [...path], address, deadline],
      });
    }
  }

  const label = (() => {
    if (!isConnected) return 'Connect wallet';
    if (sameToken(tokenIn, tokenOut)) return 'Select different tokens';
    if (derivationMismatch) return 'Pool address mismatch';
    if (!input || amountIn === null || amountIn <= 0n) return 'Enter an amount';
    if (insufficientBalance) return `Insufficient ${tokenIn.symbol}`;
    if (isLoading) return 'Loading pool…';
    if (!pool) return 'No liquidity for this pair';
    if (!quote) return 'Insufficient liquidity';
    if (severity === 'severe') return 'Price impact too high';
    if (needsApproval) return isApproving ? 'Approving…' : `Approve ${tokenIn.symbol}`;
    if (isPending || receipt.isLoading) return 'Swapping…';
    return 'Swap';
  })();

  const disabled =
    !isConnected ||
    sameToken(tokenIn, tokenOut) ||
    derivationMismatch ||
    !quote ||
    insufficientBalance ||
    severity === 'severe' ||
    isApproving ||
    isPending ||
    receipt.isLoading;

  return (
    <div className="card">
      <div className="card__header">
        <h1 className="card__title">Swap</h1>
      </div>

      <div className="stack">
        <AmountField
          label="From"
          token={tokenIn}
          exclude={tokenOut}
          value={input}
          balance={balanceIn.value}
          onValueChange={setInput}
          onTokenChange={setTokenIn}
        />

        <div className="switch">
          <button type="button" onClick={flip} aria-label="Switch tokens">
            ↓
          </button>
        </div>

        <AmountField
          label="To (estimated)"
          token={tokenOut}
          exclude={tokenIn}
          readOnly
          value={quote ? formatAmount(quote.amountOut, tokenOut.decimals) : ''}
          balance={balanceOut.value}
          onTokenChange={setTokenOut}
        />
      </div>

      <SlippageControl
        slippageBps={slippageBps}
        onChange={setSlippageBps}
        deadlineMinutes={deadlineMinutes}
        onDeadlineChange={setDeadlineMinutes}
      />

      {quote && (
        <div className="details">
          <div className="details__row">
            <span>Rate</span>
            <strong className="mono">
              1 {tokenIn.symbol} ≈{' '}
              {formatAmount(
                (quote.amountOut * 10n ** BigInt(tokenIn.decimals)) / (amountIn as bigint),
                tokenOut.decimals,
              )}{' '}
              {tokenOut.symbol}
            </strong>
          </div>
          <div className="details__row">
            <span>Price impact</span>
            <strong
              className="mono"
              style={{color: severity === 'none' ? undefined : severity === 'warn' ? 'var(--warn)' : 'var(--danger)'}}
            >
              {formatBps(quote.impactBps)}
            </strong>
          </div>
          <div className="details__row">
            <span>Minimum received</span>
            <strong className="mono">
              {formatAmount(quote.minReceived, tokenOut.decimals)} {tokenOut.symbol}
            </strong>
          </div>
          <div className="details__row">
            <span>Liquidity provider fee</span>
            <strong className="mono">{formatBps(LP_FEE_BPS)}</strong>
          </div>
          <div className="details__row">
            <span>Route</span>
            <strong>
              {tokenIn.symbol} → {tokenOut.symbol}
            </strong>
          </div>
        </div>
      )}

      {derivationMismatch && (
        <div className="alert alert--danger">
          The pair address derived locally does not match the one the factory reports. The frontend&apos;s{' '}
          <code>PAIR_INIT_CODE_HASH</code> is wrong for this deployment. Swapping is disabled until it is
          corrected.
        </div>
      )}

      {severity === 'high' && (
        <div className="alert alert--warn">
          High price impact. You are moving this pool&apos;s price significantly and will receive
          noticeably less than the mid-market rate.
        </div>
      )}
      {severity === 'severe' && (
        <div className="alert alert--danger">
          Price impact above 15%. This trade is blocked to protect you from an almost certain loss.
        </div>
      )}

      {error && (
        <div className="alert alert--danger">
          {error.message.slice(0, 220)}
        </div>
      )}

      {receipt.isSuccess && hash && (
        <div className="alert alert--info">
          Swap confirmed.{' '}
          {explorerTxUrl(hash) ? (
            <a href={explorerTxUrl(hash)} target="_blank" rel="noreferrer">
              View on Blockscout
            </a>
          ) : (
            <span className="mono">{hash}</span>
          )}
        </div>
      )}

      <div style={{marginTop: 16}}>
        <button
          className={severity === 'severe' ? 'btn btn--danger' : 'btn'}
          disabled={disabled && !needsApproval}
          onClick={() => (needsApproval ? approve() : submit())}
          type="button"
        >
          {label}
        </button>
      </div>
    </div>
  );
}
