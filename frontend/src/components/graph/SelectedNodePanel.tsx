import type { PodGraphNode } from '@podman/shared';
import { Badge } from '@/components/ui/badge';
import { statusColor, modeBlurb, VIOLET, type Mode } from './encoding.js';

export function SelectedNodePanel({
  node,
  relCount,
  flow,
  mode,
}: {
  node: PodGraphNode | undefined;
  relCount: number;
  flow: string;
  mode: Mode;
}) {
  if (!node) {
    return (
      <div className="flex h-full flex-col">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {mode === 'learn' ? 'Learning edges' : mode === 'all' ? 'Whole graph' : 'Risk path'}
        </p>
        <h3 className="mb-2 font-heading text-base font-medium">What you're looking at</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{modeBlurb(mode)}</p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Click any node to trace its{' '}
          <span className="font-medium" style={{ color: VIOLET }}>
            flow
          </span>{' '}
          — what PodMan saw, flagged, and learned. Drag to rearrange.
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {node.kind}
      </p>
      <h3 className="mb-2 mt-0.5 font-heading text-lg font-medium">{node.label}</h3>
      <div className="flex items-center justify-between border-b py-1.5 text-sm text-muted-foreground">
        <span>Status</span>
        <Badge variant="outline" style={{ color: statusColor(node.status) }}>
          {node.status}
        </Badge>
      </div>
      <div className="flex items-center justify-between border-b py-1.5 text-sm text-muted-foreground">
        <span>Relationships</span>
        <span className="font-medium text-foreground">{relCount}</span>
      </div>
      {flow && (
        <>
          <p className="mt-2.5 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
            Flow
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground/90">{flow}</p>
        </>
      )}
      {node.summary && node.summary !== flow && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{node.summary}</p>
      )}
    </div>
  );
}
