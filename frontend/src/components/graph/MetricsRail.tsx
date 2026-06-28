import type { PodGraphMetric } from '@podman/shared';
import { BLUE, RED, VIOLET, GREEN, AMBER } from './encoding.js';

const ACCENTS: Array<{ test: RegExp; color: string }> = [
  { test: /risk|collision|open/i, color: RED },
  { test: /accept/i, color: GREEN },
  { test: /learn|owner|adapt/i, color: VIOLET },
  { test: /vector|memory|store/i, color: AMBER },
];

function accentFor(label: string, i: number): string {
  for (const a of ACCENTS) if (a.test.test(label)) return a.color;
  return [BLUE, RED, VIOLET, GREEN, AMBER][i % 5] ?? BLUE;
}

export function MetricsRail({ metrics }: { metrics: PodGraphMetric[] }) {
  return (
    <div className="space-y-2.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Workflow metrics
      </p>
      {metrics.map((m, i) => (
        <div
          key={m.label}
          className="rounded-lg border bg-card py-2.5 pl-3 pr-3 shadow-sm"
          style={{ borderLeftWidth: 3, borderLeftColor: accentFor(m.label, i) }}
        >
          <p className="font-heading text-2xl font-semibold leading-none tabular-nums">{m.value}</p>
          <p className="mt-1.5 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
            {m.label}
          </p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{m.detail}</p>
        </div>
      ))}
    </div>
  );
}
