'use client';

import {useEffect, useMemo, useState} from 'react';
import {useAccount, useWaitForTransactionReceipt, useWriteContract} from 'wagmi';

import {routerAbi} from '@/config/abis';
import {explorerTxUrl} from '@/config/chain';
import {ARKSWAP_ROUTER_ADDRESS} from '@/config/contracts';
import {type Token, sameToken} from '@/config/tokens';
import {useAllowance} from '@/hooks/useAllowance';
import {useSwapRoute} from '@/hooks/useSwapRoute';
import {useTokenBalance} from '@/hooks/useTokenBalance';
import {LP_FEE_BPS, deadlineFromNow, impactSeverity, maximumSold, minimumReceived} from '@/lib/amm';
import {formatAmount, formatBps, parseAmount} from '@/lib/format';
import {useActivity} from '@/state/activity';
import {useSettings} from '@/state/settings';
import {useSwapTokens} from '@/state/swap';

import {AddToWallet} from './AddToWallet';
import {AmountField} from './AmountField';
import {SettingsPopover} from './SettingsPopover';

export function SwapCard() {
  const {isConnected, address} = useAccount();
  const {tokenIn, tokenOut, typed, setTokenIn, setTokenOut, setTyped, flip} = useSwapTokens();
  const {slippageBps, deadlineMinutes, feeOnTransfer} = useSettings();
  const {track} = useActivity();
  const [copied, setCopied] = useState(false);
  const [lastOut, setLastOut] = useState<Token | undefined>();

  const side = typed.side;
  const typedToken = side === 'in' ? tokenIn : tokenOut;

  const balanceIn = useTokenBalance(tokenIn);
  const balanceOut = useTokenBalance(tokenOut);

  const amount = useMemo(() => parseAmount(typed.value, typedToken.decimals), [typed.value, typedToken.decimals]);

  // Routing lives in the hook: it tries the direct pair, one hop through each
  // hub and two hops through hub pairs, then keeps whichever gives the best
  // deal for the side the user typed on.
  const {route, noLiquidity, isLoading, refetch} = useSwapRoute(tokenIn, tokenOut, amount, side);

  // Exact output cannot be honoured for a token that taxes transfers: the
  // router's fee-on-transfer calls only exist in exact-input form.
  const fotConflict = feeOnTransfer && side === 'out';

  const quote = useMemo(() => {
    if (!route || fotConflict) return undefined;
    return {
      amountIn: route.amountIn,
      amountOut: route.amountOut,
      minReceived: side === 'in' ? minimumReceived(route.amountOut, slippageBps) : route.amountOut,
      maxSold: side === 'out' ? maximumSold(route.amountIn, slippageBps) : route.amountIn,
      impactBps: route.impactBps,
    };
  }, [route, slippageBps, side, fotConflict]);

  const {needsApproval, approve, isApproving, approvalConfirmed, refetchAllowance} = useAllowance(
    tokenIn,
    quote?.maxSold,
  );

  useEffect(() => {
    if (approvalConfirmed) refetchAllowance();
  }, [approvalConfirmed, refetchAllowance]);

  const {writeContract, data: hash, isPending, error, reset} = useWriteContract();
  const receipt = useWaitForTransactionReceipt({hash});

  useEffect(() => {
    if (receipt.isSuccess) {
      setTyped({side, value: ''});
      refetch();
      balanceIn.refetch();
      balanceOut.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);

  const severity = quote ? impactSeverity(quote.impactBps) : 'none';
  // Native input on an exact-output swap sends the whole cap as value (the
  // router refunds the surplus), so the wallet needs the cap, not the estimate.
  const required = quote ? (tokenIn.isNative ? quote.maxSold : quote.amountIn) : undefined;
  const insufficientBalance = required !== undefined && balanceIn.value !== undefined && required > balanceIn.value;

  function onFlip() {
    flip();
    reset();
  }

  function submit() {
    if (!ARKSWAP_ROUTER_ADDRESS || !address || !quote || !route) return;

    // The full discovered path — two addresses for a direct pair, more when
    // hopping through hubs. The Router handles them identically.
    const path = [...route.path];
    const deadline = deadlineFromNow(deadlineMinutes);
    const onSuccess = (txHash: `0x${string}`) => {
      setLastOut(tokenOut);
      track({
        hash: txHash,
        kind: 'swap',
        summary: `Swap ${formatAmount(quote.amountIn, tokenIn.decimals, 4)} ${tokenIn.symbol} → ${formatAmount(quote.amountOut, tokenOut.decimals, 4)} ${tokenOut.symbol}`,
      });
    };

    if (side === 'in') {
      // Execution is always bounded on-chain by amountOutMin; the local quote is
      // only a display estimate (llm.txt s42).
      const amountIn = quote.amountIn;
      const amountOutMin = quote.minReceived;
      if (tokenIn.isNative) {
        writeContract(
          {
            address: ARKSWAP_ROUTER_ADDRESS,
            abi: routerAbi,
            functionName: feeOnTransfer
              ? 'swapExactETHForTokensSupportingFeeOnTransferTokens'
              : 'swapExactETHForTokens', // moves native KASH (llm.txt s41)
            args: [amountOutMin, path, address, deadline],
            value: amountIn,
          },
          {onSuccess},
        );
      } else if (tokenOut.isNative) {
        writeContract(
          {
            address: ARKSWAP_ROUTER_ADDRESS,
            abi: routerAbi,
            functionName: feeOnTransfer
              ? 'swapExactTokensForETHSupportingFeeOnTransferTokens'
              : 'swapExactTokensForETH', // returns native KASH
            args: [amountIn, amountOutMin, path, address, deadline],
          },
          {onSuccess},
        );
      } else {
        writeContract(
          {
            address: ARKSWAP_ROUTER_ADDRESS,
            abi: routerAbi,
            functionName: feeOnTransfer
              ? 'swapExactTokensForTokensSupportingFeeOnTransferTokens'
              : 'swapExactTokensForTokens',
            args: [amountIn, amountOutMin, path, address, deadline],
          },
          {onSuccess},
        );
      }
      return;
    }

    // Exact output: the user names what they receive and amountInMax caps what
    // they can be charged. Unused KASH is refunded by the router.
    const amountOut = quote.amountOut;
    const amountInMax = quote.maxSold;
    if (tokenIn.isNative) {
      writeContract(
        {
          address: ARKSWAP_ROUTER_ADDRESS,
          abi: routerAbi,
          functionName: 'swapETHForExactTokens',
          args: [amountOut, path, address, deadline],
          value: amountInMax,
        },
        {onSuccess},
      );
    } else if (tokenOut.isNative) {
      writeContract(
        {
          address: ARKSWAP_ROUTER_ADDRESS,
          abi: routerAbi,
          functionName: 'swapTokensForExactETH',
          args: [amountOut, amountInMax, path, address, deadline],
        },
        {onSuccess},
      );
    } else {
      writeContract(
        {
          address: ARKSWAP_ROUTER_ADDRESS,
          abi: routerAbi,
          functionName: 'swapTokensForExactTokens',
          args: [amountOut, amountInMax, path, address, deadline],
        },
        {onSuccess},
      );
    }
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  const hasAmount = Boolean(typed.value) && amount !== null && amount > 0n;

  const label = (() => {
    if (!isConnected) return 'Get started';
    if (sameToken(tokenIn, tokenOut)) return 'Select different tokens';
    if (!hasAmount) return 'Enter an amount';
    if (fotConflict) return 'Exact output unavailable';
    if (isLoading) return 'Finding best route…';
    if (noLiquidity) return 'No liquidity for this pair';
    if (!quote) return 'Insufficient liquidity';
    if (insufficientBalance) return `Insufficient ${tokenIn.symbol}`;
    if (severity === 'severe') return 'Price impact too high';
    if (needsApproval) return isApproving ? 'Approving…' : `Approve ${tokenIn.symbol}`;
    if (isPending || receipt.isLoading) return 'Swapping…';
    return 'Swap';
  })();

  const blocked =
    !isConnected ||
    sameToken(tokenIn, tokenOut) ||
    !quote ||
    insufficientBalance ||
    severity === 'severe' ||
    isApproving ||
    isPending ||
    receipt.isLoading;

  // A revert on the pair's K check is the signature of a token that takes a
  // cut on transfer; point at the setting instead of leaving a bare revert.
  const kRevert = Boolean(error && /(?:^|\W)K(?:$|\W)/.test(error.message.slice(0, 200)) && !feeOnTransfer);

  const deriving = hasAmount && isLoading && !quote;

  return (
    <div className="card">
      <SettingsPopover
        extra={
          <button className="icon-btn" type="button" onClick={share} aria-label="Copy a link to this swap" title="Copy link">
            {copied ? <CheckIcon /> : <LinkIcon />}
          </button>
        }
      />

      <AmountField
        label="Sell"
        token={tokenIn}
        exclude={tokenOut}
        value={side === 'in' ? typed.value : quote ? formatAmount(quote.amountIn, tokenIn.decimals) : ''}
        loading={side === 'out' && deriving}
        balance={balanceIn.value}
        balanceLoading={balanceIn.isLoading}
        onValueChange={(v) => setTyped({side: 'in', value: v})}
        onTokenChange={setTokenIn}
      />

      <div className="switch">
        <button type="button" onClick={onFlip} aria-label="Switch tokens">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14m0 0-5-5m5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <AmountField
        label={side === 'out' ? 'Buy (exactly)' : 'Buy'}
        token={tokenOut}
        exclude={tokenIn}
        value={side === 'out' ? typed.value : quote ? formatAmount(quote.amountOut, tokenOut.decimals) : ''}
        loading={side === 'in' && deriving}
        balance={balanceOut.value}
        balanceLoading={balanceOut.isLoading}
        onValueChange={(v) => setTyped({side: 'out', value: v})}
        onTokenChange={setTokenOut}
      />

      {quote && (
        <div className="details">
          <div className="details__row">
            <span>Rate</span>
            <strong className="mono">
              1 {tokenIn.symbol} ={' '}
              {formatAmount(
                (quote.amountOut * 10n ** BigInt(tokenIn.decimals)) / quote.amountIn,
                tokenOut.decimals,
              )}{' '}
              {tokenOut.symbol}
            </strong>
          </div>
          <div className="details__row">
            <span>Price impact</span>
            <strong
              className="mono"
              style={{
                color:
                  severity === 'none'
                    ? undefined
                    : severity === 'warn'
                      ? 'var(--warn)'
                      : 'var(--danger)',
              }}
            >
              {formatBps(quote.impactBps)}
            </strong>
          </div>
          {side === 'in' ? (
            <div className="details__row">
              <span>Minimum received</span>
              <strong className="mono">
                {formatAmount(quote.minReceived, tokenOut.decimals)} {tokenOut.symbol}
              </strong>
            </div>
          ) : (
            <div className="details__row">
              <span>Maximum sold</span>
              <strong className="mono">
                {formatAmount(quote.maxSold, tokenIn.decimals)} {tokenIn.symbol}
              </strong>
            </div>
          )}
          <div className="details__row">
            <span>Liquidity provider fee</span>
            <strong className="mono">{formatBps(LP_FEE_BPS)}</strong>
          </div>
          <div className="details__row">
            <span>Route</span>
            <strong>
              {route ? route.symbols.join(' → ') : `${tokenIn.symbol} → ${tokenOut.symbol}`}
              {route && route.path.length > 2 && (
                <span className="muted" style={{fontWeight: 400}}>
                  {' '}
                  ({route.path.length - 2} hop{route.path.length > 3 ? 's' : ''})
                </span>
              )}
            </strong>
          </div>
        </div>
      )}

      {fotConflict && hasAmount && (
        <div className="alert alert--warn">
          Fee-on-transfer mode is on, and the router can only honour an exact output for tokens that do not tax
          transfers. Type the amount you are selling instead, or turn the setting off.
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
          {error.message.slice(0, 200)}
          {kRevert && (
            <>
              {' '}
              This looks like a token that takes a fee on transfer. Enable “Fee-on-transfer tokens” in settings
              and try again.
            </>
          )}
        </div>
      )}

      {receipt.isSuccess && hash && (
        <div className="alert alert--accent">
          Swap confirmed.{' '}
          {explorerTxUrl(hash) ? (
            <a href={explorerTxUrl(hash)} target="_blank" rel="noreferrer">
              View on Blockscout ↗
            </a>
          ) : (
            <span className="mono">{hash}</span>
          )}
          {lastOut && !lastOut.isNative && (
            <div style={{marginTop: 8}}>
              <AddToWallet token={lastOut} />
            </div>
          )}
        </div>
      )}

      <button
        className={
          severity === 'severe' ? 'btn btn--danger' : needsApproval || !blocked ? 'btn btn--primary' : 'btn'
        }
        disabled={blocked && !needsApproval}
        onClick={() => (needsApproval ? approve() : submit())}
        type="button"
      >
        {label}
      </button>
    </div>
  );
}

function LinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m5 12 5 5L20 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
