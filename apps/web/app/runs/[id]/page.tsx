import { notFound } from 'next/navigation';
import type { Probe } from '@widen/core';
import { getRun } from '../../../lib/runs';
import { SaturationChart } from './SaturationChart';

export const dynamic = 'force-dynamic';

function pct(x: number | null): string {
  return x == null ? 'n/a' : `${Math.round(x * 100)}%`;
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();

  const cov = run.coverage;
  const probeById = new Map<string, Probe>(run.probes.map((p) => [p.id, p]));
  const recap = cov.recapture;

  const axisEntries = Object.entries(cov.diversity.byAxis).filter(([, n]) => n > 0);
  const maxAxis = Math.max(1, ...axisEntries.map(([, n]) => n));

  return (
    <>
      <p className="small">
        <a href="/">← all runs</a>
      </p>

      {/* verdict banner */}
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>“{run.query}”</h2>
          <span className={`badge ${cov.verdict}`}>{cov.verdict}</span>
        </div>
        <p style={{ marginBottom: 6 }}>{cov.verdictReason}</p>
        <p className="dim small" style={{ margin: 0 }}>
          {new Date(run.createdAt).toLocaleString()} · stopped on{' '}
          <span className="mono">{cov.stopReason}</span> · ~{run.estimatedCredits} credits ·{' '}
          {run.config.llm ? 'LLM-enhanced expansion' : 'deterministic expansion'} ·{' '}
          {run.config.rerank
            ? `ranked: RRF rank-fusion, MMR diversity ${run.config.diversity ?? 0}`
            : 'discovery order'}
        </p>
      </div>

      {/* headline stats */}
      <div className="grid cols-4">
        <div className="stat">
          <div className="num">{cov.uniqueDomains}</div>
          <div className="label">unique domains</div>
        </div>
        <div className="stat">
          <div className="num">{cov.uniqueUrls}</div>
          <div className="label">unique sources</div>
        </div>
        <div className="stat">
          <div className="num">{pct(recap.coverage)}</div>
          <div className="label">est. coverage (Chao1)</div>
        </div>
        <div className="stat">
          <div className="num">
            {cov.probesOk}
            <span className="dim small">/{cov.probesIssued}</span>
          </div>
          <div className="label">probes ok{cov.probesFailed > 0 ? ` · ${cov.probesFailed} failed` : ''}</div>
        </div>
      </div>

      {/* saturation */}
      <div className="panel">
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Saturation</h3>
        <SaturationChart curve={cov.saturationCurve} estimatedTotal={recap.estimatedTotalDomains} />
        <p className="dim small">
          Cyan line = cumulative domains found. Bars = new domains each probe added. Dashed = Chao1
          estimate of total discoverable domains ({recap.singletons} found by a single probe,{' '}
          {recap.doubletons} by two). {recap.caveat}
        </p>
      </div>

      {/* where the long tail came from */}
      <div className="panel">
        <h3 style={{ marginTop: 0, fontSize: 14 }}>Where coverage came from</h3>
        <table>
          <tbody>
            {axisEntries.map(([axis, n]) => (
              <tr key={axis}>
                <td className="mono" style={{ width: 130 }}>{axis}</td>
                <td style={{ width: 280 }}>
                  <span className="axisbar" style={{ width: `${(n / maxAxis) * 100}%` }} />
                </td>
                <td className="mono">{n} domains</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="dim small" style={{ marginBottom: 0 }}>
          Top-5 domains hold {pct(cov.diversity.top5DomainShare)} of all sources ·{' '}
          {Object.entries(cov.diversity.bySource).map(([s, c]) => `${c} ${s}`).join(' · ')}
        </p>
      </div>

      {/* failures, surfaced */}
      {cov.failures.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Failed probes ({cov.failures.length})</h3>
          <table>
            <thead>
              <tr><th>status</th><th>probe</th><th>error</th></tr>
            </thead>
            <tbody>
              {cov.failures.map((f, i) => (
                <tr key={i}>
                  <td><span className="badge thin">{f.status}</span></td>
                  <td className="dim small">{probeById.get(f.probeId)?.query ?? f.probeId}</td>
                  <td className="dim small mono">{f.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* sources */}
      <div className="panel">
        <h3 style={{ marginTop: 0, fontSize: 14 }}>
          Sources ({run.sources.length}){' '}
          <span className="dim small">★ = found by only one probe (long-tail)</span>
        </h3>
        <table>
          <thead>
            <tr>
              <th></th><th>domain</th><th>title</th><th>found by</th><th>type</th>
            </tr>
          </thead>
          <tbody>
            {run.sources.map((s) => {
              const axes = [...new Set(s.foundByProbes.map((p) => probeById.get(p)?.axis).filter(Boolean))];
              return (
                <tr key={s.url}>
                  <td>{s.foundByProbes.length === 1 ? <span className="star">★</span> : ''}</td>
                  <td className="mono small">{s.domain}</td>
                  <td>
                    <a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a>
                  </td>
                  <td className="small">
                    {s.foundByProbes.length}
                    <span className="dim"> · {axes.join(', ')}</span>
                  </td>
                  <td><span className="tag">{s.source}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
