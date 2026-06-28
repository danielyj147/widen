import type { SaturationPoint } from '@widen/core';

/**
 * The saturation curve: cumulative unique domains (line) and per-probe new
 * domains (bars). A line that keeps climbing = still finding the long tail; a
 * flat tail = saturated. Pure SVG, no chart dependency.
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

  if (curve.length === 0) return <p className="dim">No probes ran.</p>;

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
      {/* estimated-total reference line (Chao1) */}
      <line x1={pad.l} x2={W - pad.r} y1={yCum(estimatedTotal)} y2={yCum(estimatedTotal)}
        stroke="var(--yellow)" strokeDasharray="4 4" opacity={0.5} />
      <text x={W - pad.r} y={yCum(estimatedTotal) - 4} fill="var(--yellow)" fontSize="10"
        textAnchor="end" opacity={0.8}>
        est. discoverable ≈ {estimatedTotal}
      </text>

      {/* per-probe new-domain bars (from bottom) */}
      {curve.map((p, i) => (
        <rect key={i} x={x(i) - barW / 2} width={barW} y={pad.t + ih - yNew(p.newDomains)}
          height={yNew(p.newDomains)} fill="var(--border)" />
      ))}

      {/* cumulative line + points */}
      <path d={linePath} fill="none" stroke="var(--cyan)" strokeWidth={2} />
      {curve.map((p, i) => (
        <circle key={i} cx={x(i)} cy={yCum(p.cumulativeDomains)} r={2.5} fill="var(--cyan)" />
      ))}

      {/* axes labels */}
      <text x={pad.l} y={H - 8} fill="var(--dim)" fontSize="10">probe 1</text>
      <text x={W - pad.r} y={H - 8} fill="var(--dim)" fontSize="10" textAnchor="end">probe {n}</text>
      <text x={4} y={pad.t + 8} fill="var(--cyan)" fontSize="10">domains</text>
    </svg>
  );
}
