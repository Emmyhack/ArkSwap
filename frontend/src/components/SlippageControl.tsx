'use client';

const PRESETS = [10n, 50n, 100n];

/**
 * Slippage tolerance in basis points (llm.txt s43).
 *
 * The default is 0.50%. Zero is deliberately not offered as a preset and is
 * rejected on entry: `amountOutMin = 0` hands the entire trade to whoever
 * sequences the block.
 */
export function SlippageControl({
  slippageBps,
  onChange,
  deadlineMinutes,
  onDeadlineChange,
}: {
  slippageBps: bigint;
  onChange: (bps: bigint) => void;
  deadlineMinutes: number;
  onDeadlineChange: (minutes: number) => void;
}) {
  return (
    <>
      <div className="settings">
        <span className="muted" style={{fontSize: 13}}>Slippage</span>
        {PRESETS.map((preset) => (
          <button
            key={preset.toString()}
            type="button"
            className="settings__chip"
            data-active={slippageBps === preset}
            onClick={() => onChange(preset)}
          >
            {Number(preset) / 100}%
          </button>
        ))}
        <input
          className="settings__input mono"
          inputMode="decimal"
          value={(Number(slippageBps) / 100).toString()}
          onChange={(e) => {
            const parsed = Number(e.target.value);
            if (!Number.isFinite(parsed)) return;
            const bps = BigInt(Math.round(parsed * 100));
            // Never allow a zero-slippage swap (llm.txt s43).
            if (bps <= 0n || bps > 5000n) return;
            onChange(bps);
          }}
          aria-label="Custom slippage percent"
        />
      </div>
      <div className="settings">
        <span className="muted" style={{fontSize: 13}}>Deadline</span>
        <input
          className="settings__input mono"
          inputMode="numeric"
          value={deadlineMinutes}
          onChange={(e) => {
            const parsed = Number(e.target.value);
            if (Number.isFinite(parsed) && parsed > 0 && parsed <= 180) onDeadlineChange(parsed);
          }}
          aria-label="Deadline in minutes"
        />
        <span className="muted" style={{fontSize: 13}}>minutes</span>
      </div>
    </>
  );
}
