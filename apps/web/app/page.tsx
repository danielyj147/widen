import { AlertTriangle } from 'lucide-react';
import { hasApiKey } from '@/lib/runs';
import { NewRunForm } from './NewRunForm';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const keyPresent = hasApiKey();
  return (
    <div className="mx-auto mt-[8vh] max-w-2xl">
      <h2 className="text-2xl font-semibold tracking-tight">Search wider, not deeper</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        One query becomes many probes across news, regional press, forums, and primary docs — then
        merged, deduped, and scored for how complete the search actually was.
      </p>

      {!keyPresent && (
        <p className="text-amber-500 border-amber-500/40 bg-amber-500/10 mt-5 flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 flex-none" />
          <span>
            <code className="font-mono">FIRECRAWL_API_KEY</code> isn’t set. Add it to the repo-root{' '}
            <code className="font-mono">.env</code> and reload — ad-hoc runs are disabled until then.
          </span>
        </p>
      )}

      <div className="mt-6">
        <NewRunForm disabled={!keyPresent} />
      </div>
    </div>
  );
}
