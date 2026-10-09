'use client';

import {useEffect, useRef, useState} from 'react';
import {useAccount} from 'wagmi';

import {explorerTxUrl} from '@/config/chain';
import {shortenAddress} from '@/lib/format';
import {type ActivityItem, isStale, useActivity} from '@/state/activity';

/**
 * Recent transactions from this browser, with pending ones surfaced in the nav.
 */
export function ActivityMenu({inline}: {inline?: boolean}) {
  const {isConnected} = useAccount();
  const {items, pendingCount, dismiss, clear} = useActivity();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!isConnected) return null;

  const list = (
    <div className="activity__list">
      {items.length === 0 && <div className="activity__empty">No transactions from this browser yet.</div>}
      {items.slice(0, 20).map((item) => (
        <ActivityRow key={item.hash} item={item} onDismiss={() => dismiss(item.hash)} />
      ))}
      {items.some((i) => i.status === 'pending' && !isStale(i)) && (
        <div className="activity__note">
          A pending transaction can only be sped up or cancelled from your wallet, by replacing it with the same
          nonce. Dismissing here just hides the entry.
        </div>
      )}
      {items.some((i) => i.status !== 'pending' || isStale(i)) && (
        <button type="button" className="activity__clear" onClick={clear}>
          Clear history
        </button>
      )}
    </div>
  );

  if (inline) {
    return (
      <div className="activity activity--inline">
        <div className="popover__label" style={{marginBottom: 6}}>
          Activity{pendingCount > 0 && ` · ${pendingCount} pending`}
        </div>
        {list}
      </div>
    );
  }

  return (
    <div className="activity" ref={ref}>
      <button
        type="button"
        className="btn-connect btn-connect--ghost"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Transaction activity"
      >
        {pendingCount > 0 ? (
          <>
            <span className="spinner" aria-hidden /> {pendingCount} pending
          </>
        ) : (
          <ClockIcon />
        )}
      </button>
      {open && (
        <div className="popover popover--activity" role="dialog" aria-label="Recent transactions">
          <div className="popover__row">
            <span className="popover__label">Recent transactions</span>
            {list}
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityRow({item, onDismiss}: {item: ActivityItem; onDismiss: () => void}) {
  const url = explorerTxUrl(item.hash);
  const stale = isStale(item);
  const status = stale
    ? 'Not found on chain'
    : item.status === 'pending'
      ? 'Pending'
      : item.status === 'confirmed'
        ? 'Confirmed'
        : 'Failed';
  const body = (
    <>
      <span className={`activity__dot activity__dot--${stale ? 'failed' : item.status}`} aria-hidden />
      <span className="activity__text">
        <span className="activity__summary">{item.summary}</span>
        <span className="activity__meta">
          {status} · <span className="mono">{shortenAddress(item.hash)}</span>
        </span>
      </span>
      {url && <span className="activity__ext">↗</span>}
    </>
  );
  return (
    <div className="activity__item">
      {url ? (
        <a className="activity__row" href={url} target="_blank" rel="noreferrer">
          {body}
        </a>
      ) : (
        <div className="activity__row">{body}</div>
      )}
      <button type="button" className="icon-btn icon-btn--sm" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
