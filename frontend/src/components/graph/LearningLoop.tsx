import type { LearningStage } from '@podman/shared';
import { BLUE } from './encoding.js';

/**
 * The continual-learning loop rail: observe → store → predict → outcome → adapt.
 * The active stage (most-recent activity) gets a pulsing accent bar + ring.
 */
export function LearningLoop({ stages }: { stages: LearningStage[] }) {
  return (
    <div className="space-y-1">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Learning loop
      </p>
      {stages.map((s, i) => (
        <div key={s.key}>
          <div
            className="relative overflow-hidden rounded-lg border bg-card py-2 pl-3.5 pr-3 shadow-sm transition-colors data-[active=true]:bg-accent/40"
            data-active={s.active}
            style={s.active ? { boxShadow: `inset 0 0 0 1px ${BLUE}55` } : undefined}
          >
            <span
              aria-hidden
              className={`absolute inset-y-0 left-0 w-1 ${s.active ? 'pm-pulse' : ''}`}
              style={{ background: s.active ? BLUE : 'var(--border)' }}
            />
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
                <span className="tabular-nums">{String(i + 1).padStart(2, '0')}</span> {s.title}
              </p>
              <p className="font-heading text-sm font-semibold tabular-nums">{s.value}</p>
            </div>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{s.detail}</p>
          </div>
          {i < stages.length - 1 && (
            <p aria-hidden className="py-0.5 text-center text-xs leading-none text-muted-foreground/60">
              ↓
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
