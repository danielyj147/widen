import type { SaturationPoint } from '@widen/core';

/**
 * The saturation curve: cumulative unique domains (line) and per-probe new
 * domains (bars), with the Chao1 estimate of total discoverable domains as a
 * dashed reference. A line that keeps climbing = still finding the long tail; a
 * flat tail = saturated. Pure SVG, themed via CSS tokens.
 */
export function SaturationChart({
  curve,
  estimatedTotal,
}: {
  curve: SaturationPoint[];
  estimatedTotal: number;
}) {
  const W = 720;
  const H = 220;
  const pad = { l: 40, r: 16, t: 16, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  if (curve.length === 0) return <p className="text-muted-foreground text-sm">No probes ran.</p>;

  const maxCum = Math.max(estimatedTotal, curve[curve.length - 1]!.cumulativeDomains, 1);
  const maxNew = Math.max(...curve.map((p) => p.newDomains), 1);
  const n = curve.length;
  const x = (i: number) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yCum = (v: number) => pad.t + ih - (v / maxCum) * ih;
  const yNew = (v: number) => (v / maxNew) * (ih * 0.5);

  const linePath = curve
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${yCum(p.cumulativeDomains).toFixed(1)}`)
    .join(' ');
  const barW = Math.max(2, Math.min(20, iw / n - 4));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="saturation curve">
      <line x1={pad.l} x2={W - pad.r} y1={yCum(estimatedTotal)} y2={yCum(estimatedTotal)}
        stroke="var(--muted-foreground)" strokeDasharray="4 4" opacity={0.5} />
      {curve.map((p, i) => (
        <rect key={i} x={x(i) - barW / 2} width={barW} y={pad.t + ih - yNew(p.newDomains)}
          height={yNew(p.newDomains)} fill="var(--muted-foreground)" opacity={0.3} />
      ))}
      <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth={2} />
      {curve.map((p, i) => (
        <circle key={i} cx={x(i)} cy={yCum(p.cumulativeDomains)} r={2.5} fill="var(--primary)" />
      ))}
      <text x={pad.l} y={H - 8} fill="var(--muted-foreground)" fontSize="10">search 1</text>
      <text x={(pad.l + W - pad.r) / 2} y={H - 8} fill="var(--muted-foreground)" fontSize="10" textAnchor="middle">
        searches →
      </text>
      <text x={W - pad.r} y={H - 8} fill="var(--muted-foreground)" fontSize="10" textAnchor="end">search {n}</text>
      <text x={4} y={pad.t + 8} fill="var(--primary)" fontSize="10">sources</text>
    </svg>
  );
}
