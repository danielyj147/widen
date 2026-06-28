/** Tiny ANSI helpers — no dependency. Honors NO_COLOR and non-TTY output. */
const enabled = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string | number) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : `${s}`);

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  cyan: wrap('36'),
  gray: wrap('90'),
};

import type { Verdict } from '@widen/core';

export function verdictBadge(v: Verdict): string {
  switch (v) {
    case 'saturated':
      return c.green('● saturated');
    case 'moderate':
      return c.yellow('● moderate');
    case 'thin':
      return c.red('● thin');
  }
}

export function statusGlyph(status: string): string {
  switch (status) {
    case 'ok':
      return c.green('ok');
    case 'empty':
      return c.gray('empty');
    case 'rate-limited':
      return c.yellow('rate-limited');
    case 'timeout':
      return c.yellow('timeout');
    default:
      return c.red('error');
  }
}

/** A compact horizontal bar for the saturation curve in the terminal. */
export function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  const ticks = '▁▂▃▄▅▆▇█';
  const max = Math.max(...values, 1);
  return values
    .map((v) => ticks[Math.min(ticks.length - 1, Math.round((v / max) * (ticks.length - 1)))])
    .join('');
}

export function pct(x: number | null): string {
  return x == null ? 'n/a' : `${Math.round(x * 100)}%`;
}
