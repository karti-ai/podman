import type { ActivityEvent } from '@podman/shared';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ACTIVITY_TAG } from './encoding.js';

const fmtTime = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hour12: false });

function timeOf(at: string): string {
  const t = new Date(at).getTime();
  return Number.isFinite(t) ? fmtTime.format(t) : '--:--';
}

export function ActivityStream({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="flex h-full flex-col">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Activity stream
      </p>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ScrollArea className="h-[176px] pr-3">
          <ul className="space-y-1.5">
            {events.map((e) => {
              const tag = ACTIVITY_TAG[e.kind];
              return (
                <li key={e.id} className="pm-enter flex items-start gap-2.5 text-sm">
                  <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {timeOf(e.at)}
                  </span>
                  <span
                    className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide"
                    style={{ color: tag.color, background: `${tag.color}1a` }}
                  >
                    {tag.label}
                  </span>
                  <span className="min-w-0 flex-1 leading-snug text-foreground/90">{e.text}</span>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
