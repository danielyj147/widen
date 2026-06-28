import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'widen — search coverage dashboard',
  description: 'Probe wide, merge, and see how complete a Firecrawl search actually was.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="wrap">
          <header className="top">
            <h1>
              <a href="/" style={{ color: 'inherit' }}>
                <span className="accent">widen</span> · search coverage
              </a>
            </h1>
            <span className="dim small">
              probe wide, not deep · a layer on Firecrawl /search
            </span>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
