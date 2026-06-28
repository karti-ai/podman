import type { PodGraphNode } from '@podman/shared';
import { Badge } from '@/components/ui/badge';
import { statusColor, VIOLET } from './encoding.js';

export function SelectedNodePanel({
  node,
  relCount,
}: {
  node: PodGraphNode | undefined;
  relCount: number;
}) {
  if (!node) {
    return (
      <div className="flex h-full flex-col">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Continual learning
        </p>
        <h3 className="mb-2 font-heading text-base font-medium">It learned</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The violet{' '}
          <span className="font-medium" style={{ color: VIOLET }}>
            learned_from
          </span>{' '}
          edges are ownership PodMan retained from accepted interventions — the graph gets sharper
          every session. Click any node to trace its relationships, or drag to rearrange.
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
      {node.summary && (
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{node.summary}</p>
      )}
    </div>
  );
}
