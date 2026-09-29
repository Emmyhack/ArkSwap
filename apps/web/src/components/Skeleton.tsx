/** Shimmering placeholder sized like the value it stands in for. */
export function Skeleton({width = 80, height = 14, style}: {width?: number | string; height?: number; style?: React.CSSProperties}) {
  return <span className="skeleton" aria-hidden style={{width, height, ...style}} />;
}
