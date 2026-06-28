import './globals.css';
import type { ReactNode } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import { cn } from '@/lib/utils';
import { getRuns } from '@/lib/runs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Sidebar } from './Sidebar';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata = {
  title: 'Firecrawl Studio',
  description: 'Search wide, merge, and see how complete a Firecrawl search actually was.',
  // We already ship our own dark theme — tell the Dark Reader extension to leave
  // the page alone (its official opt-out). This also stops the extension from
  // mutating the DOM and tripping hydration warnings.
  other: { 'darkreader-lock': 'true' },
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: ReactNode }) {
  const runs = await getRuns();
  return (
    // suppressHydrationWarning: color/theme browser extensions (e.g. Dark Reader)
    // mutate the DOM before React hydrates — this is the documented use for it
    // and does not mask real mismatches in our own markup.
    <html
      lang="en"
      suppressHydrationWarning
      className={cn('dark', geist.variable, geistMono.variable)}
    >
      <body suppressHydrationWarning className="font-sans antialiased">
        <TooltipProvider delayDuration={150}>
          <div className="flex min-h-screen">
            <Sidebar runs={runs} />
            <main className="min-w-0 flex-1">
              <div className="mx-auto w-full max-w-4xl px-6 py-8 md:px-10">{children}</div>
            </main>
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
