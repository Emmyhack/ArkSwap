'use client';

import {useEffect, useRef, useState} from 'react';

import {SlippageControl} from './SlippageControl';

/**
 * Slippage and deadline, tucked behind a gear the way the familiar swap UX does.
 *
 * They stay one click away rather than buried: `amountOutMin` is the user's only
 * on-chain protection, so it must remain visible and adjustable (llm.txt s43).
 */
export function SettingsPopover({
  slippageBps,
  onSlippageChange,
  deadlineMinutes,
  onDeadlineChange,
}: {
  slippageBps: bigint;
  onSlippageChange: (bps: bigint) => void;
  deadlineMinutes: number;
  onDeadlineChange: (minutes: number) => void;
}) {
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

  // Surface a non-default tolerance on the gear itself, so a risky setting is
  // never hidden behind a closed menu.
  const isDefault = slippageBps === 50n && deadlineMinutes === 20;

  return (
    <div className="card__tools" ref={ref}>
      {!isDefault && (
        <span className="settings__label" style={{alignSelf: 'center', marginRight: 8}}>
          {Number(slippageBps) / 100}% slippage
        </span>
      )}
      <button
        className="icon-btn"
        data-active={open || !isDefault}
        onClick={() => setOpen((v) => !v)}
        type="button"
        aria-label="Transaction settings"
        aria-expanded={open}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </svg>
      </button>

      {open && (
        <div className="popover" role="dialog" aria-label="Transaction settings">
          <div className="popover__row">
            <span className="popover__label">Slippage tolerance &amp; deadline</span>
            <SlippageControl
              slippageBps={slippageBps}
              onChange={onSlippageChange}
              deadlineMinutes={deadlineMinutes}
              onDeadlineChange={onDeadlineChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}
