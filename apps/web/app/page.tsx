import { getRuns, hasApiKey } from '../lib/runs';
import { NewRunForm } from './NewRunForm';

export const dynamic = 'force-dynamic'; // always reflect the runs/ dir

function pct(x: number | null): string {
  return x == null ? 'n/a' : `${Math.round(x * 100)}%`;
}

export default async function Home() {
  const [runs, keyPresent] = await Promise.all([getRuns(), Promise.resolve(hasApiKey())]);

  return (
    <>
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 15 }}>Run a search</h2>
        {!keyPresent && (
          <p className="notice error small">
            FIRECRAWL_API_KEY isn’t set. Add it to the repo-root <span className="mono">.env</span> and reload.
            Ad-hoc runs are disabled until then.
          </p>
        )}
        <NewRunForm disabled={!keyPresent} />
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 15 }}>
          Runs <span className="dim small">({runs.length})</span>
        </h2>
        {runs.length === 0 ? (
          <p className="dim">
            No runs yet. Start one above, or from the CLI:{' '}
            <span className="mono">npm run widen -- search "your topic"</span>
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>verdict</th>
                <th>query</th>
                <th>domains</th>
                <th>coverage</th>
                <th>probes</th>
                <th>when</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className={`badge ${r.verdict}`}>{r.verdict}</span>
                  </td>
                  <td>
                    <a href={`/runs/${r.id}`}>{r.query}</a>
                  </td>
                  <td className="mono">{r.uniqueDomains}</td>
                  <td className="mono">{pct(r.coveragePct)}</td>
                  <td className="mono">
                    {r.probesIssued}
                    {r.probesFailed > 0 && <span className="star" title="failed probes"> !{r.probesFailed}</span>}
                  </td>
                  <td className="dim small">{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
