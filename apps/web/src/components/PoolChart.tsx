'use client';

import {ANALYTICS_UNAVAILABLE} from '@arkswap/sdk';
import type {ChartPoint} from '@arkswap/types';
import {useMemo, useState} from 'react';

import {useDeepestPair, usePairChart} from '@/hooks/useAnalytics';

/**
 * TVL and volume history for the deepest pool.
 *
 * Drawn from indexed history, not from a model: each point is a bucket the
 * indexer closed at the time, so a gap in the series is a gap in what was
 * recorded rather than something to interpolate over. Analytics only — the
 * liquidity form beside it never reads this (llm.txt s38).
 */
type Interval = '1h' | '1d';

export function PoolChart() {
  const [interval, setInterval] = useState<Interval>('1h');
  const {data: pairResult} = useDeepestPair();

  const pair = pairResult?.ok ? pairResult.data : undefined;
  const {data: chart, isLoading} = usePairChart(pair?.address, interval);

  const points = chart?.ok ? chart.data : undefined;
  const unavailable = Boolean((pairResult && !pairResult.ok) || (chart && !chart.ok));

  // A single bucket is a dot, not a trend. Saying so beats drawing a flat line
  // that implies the price never moved.
  const priced = useMemo(() => (points ?? []).filter((p) => p.tvlUsd !== null), [points]);
  const enoughHistory = priced.length >= 2;

  if (!isLoading && !unavailable && !pair) return null;

  return (
    <section className="card pool-chart">
      <div className="card__header">
        <div>
          <h3 className="card__title">
            {pair ? `${pair.token0.symbol ?? '?'} / ${pair.token1.symbol ?? '?'}` : 'Deepest pool'}
          </h3>
          <span className="pool-chart__sub">
            {pair?.tvlUsd ? `$${Number(pair.tvlUsd).toLocaleString()} locked` : 'indexed history'}
          </span>
        </div>
        <div className="pool-chart__toggle">
          {(['1h', '1d'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={value === interval ? 'is-active' : undefined}
              onClick={() => setInterval(value)}
            >
              {value === '1h' ? 'Hourly' : 'Daily'}
            </button>
          ))}
        </div>
      </div>

      {unavailable && <div className="alert alert--warn">{ANALYTICS_UNAVAILABLE}</div>}

      {!unavailable && isLoading && <div className="pool-chart__empty">Loading history…</div>}

      {!unavailable && !isLoading && !enoughHistory && (
        <div className="pool-chart__empty">
          Not enough history yet — the indexer records one point per {interval === '1h' ? 'hour' : 'day'} in
          which reserves changed.
        </div>
      )}

      {enoughHistory && <Sparkline points={priced} interval={interval} />}
    </section>
  );
}

/**
 * TVL as a line, volume as bars beneath it, in plain SVG.
 *
 * No charting library: the shape is simple, and a dependency here would be
 * bytes shipped to every visitor for one panel.
 */
function Sparkline({points, interval}: {points: ChartPoint[]; interval: Interval}) {
  const W = 640;
  const H = 160;
  const PAD = 8;

  const tvls = points.map((p) => Number(p.tvlUsd));
  const vols = points.map((p) => Number(p.volumeUsd));
  const maxTvl = Math.max(...tvls);
  const minTvl = Math.min(...tvls);
  const maxVol = Math.max(...vols, 1);

  // A perfectly flat series would divide by zero; drawing it mid-height is the
  // honest rendering of "this did not move".
  const span = maxTvl - minTvl || 1;
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(points.length - 1, 1);
  const y = (v: number) => PAD + (1 - (v - minTvl) / span) * (H - PAD * 2 - 30);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(Number(p.tvlUsd)).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - 30} L${x(0).toFixed(1)},${H - 30} Z`;

  return (
    <div className="pool-chart__canvas">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Pool TVL and volume history">
        <defs>
          <linearGradient id="tvlFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {points.map((p, i) => {
          const v = Number(p.volumeUsd);
          const h = (v / maxVol) * 24;
          return (
            <rect
              key={p.timestamp}
              x={x(i) - 3}
              y={H - 4 - h}
              width={6}
              height={Math.max(h, v > 0 ? 1.5 : 0)}
              rx={1.5}
              fill="var(--accent)"
              opacity={0.5}
            />
          );
        })}

        <path d={area} fill="url(#tvlFill)" />
        <path d={line} fill="none" stroke="var(--accent-hi)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>

      <div className="pool-chart__axis">
        <span>{formatBucket(points[0].timestamp, interval)}</span>
        <span className="pool-chart__legend">TVL · volume</span>
        <span>{formatBucket(points[points.length - 1].timestamp, interval)}</span>
      </div>
    </div>
  );
}

/**
 * Labels the ends of the axis.
 *
 * Hourly buckets often share a day, so a date alone would print the same label
 * at both ends and imply the series covers no time at all.
 */
function formatBucket(timestamp: number, interval: Interval): string {
  const d = new Date(timestamp * 1000);
  return interval === '1h'
    ? d.toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric'})
    : d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}
