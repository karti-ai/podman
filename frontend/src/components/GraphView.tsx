import { useEffect, useMemo, useState } from 'react';
import type { PodGraph } from '@podman/shared';
import { fetchPodGraph, backendEventsUrl } from '../lib/graph.js';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { GraphCanvas } from './graph/GraphCanvas.js';
import { MetricsRail } from './graph/MetricsRail.js';
import { LearningLoop } from './graph/LearningLoop.js';
import { ActivityStream } from './graph/ActivityStream.js';
import { SelectedNodePanel } from './graph/SelectedNodePanel.js';
import { highlightFor, flowNarrative, NODE_LEGEND, EDGE_LEGEND, type Mode } from './graph/encoding.js';

const POLL_MS = 5000;

// Note: pm-enter must NOT use animation-fill-mode (both/forwards) — a held final
// keyframe (opacity:1) would override the .pm-dim cascade and defeat dimming.
const GRAPH_CSS = `
  .pm-node{cursor:grab;transition:opacity .25s ease}
  .pm-node:active{cursor:grabbing}
  .pm-edge{transition:opacity .25s ease}
  .pm-lbl{fill:var(--foreground);font-size:11px;font-weight:500;pointer-events:none;
    paint-order:stroke;stroke:var(--card);stroke-width:3.5px;stroke-linejoin:round}
  .pm-dim{opacity:.14}
  .pm-enter{animation:pm-fade .45s ease}
  .pm-dash{animation:pm-flow 1s linear infinite}
  .pm-pulse{animation:pm-pulse 1.7s ease-in-out infinite}
  @keyframes pm-fade{from{opacity:0}to{opacity:1}}
  @keyframes pm-flow{to{stroke-dashoffset:-26}}
  @keyframes pm-pulse{0%,100%{opacity:.45}50%{opacity:1}}
  @media (prefers-reduced-motion:reduce){
    .pm-enter,.pm-dash,.pm-pulse{animation:none}
  }
`;

export function GraphView({ podId, onClose }: { podId: string; onClose: () => void }) {
  const [graph, setGraph] = useState<PodGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('risk');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let nudge: number | null = null;
    setGraph(null);
    setError(null);
    setSelected(null);

    const load = () =>
      fetchPodGraph(podId)
        .then((g) => {
          if (alive) {
            setGraph(g);
            setError(null);
          }
        })
        .catch((e: unknown) => {
          if (alive) setError(e instanceof Error ? e.message : String(e));
        });

    void load();
    const poll = window.setInterval(() => void load(), POLL_MS);

    // Best-effort realtime nudge: refetch (debounced) when the agent broadcasts.
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(backendEventsUrl());
      ws.onmessage = () => {
        if (nudge != null) return;
        nudge = window.setTimeout(() => {
          nudge = null;
          void load();
        }, 800);
      };
    } catch {
      /* event bus is optional */
    }

    return () => {
      alive = false;
      window.clearInterval(poll);
      if (nudge != null) window.clearTimeout(nudge);
      ws?.close();
    };
  }, [podId]);

  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);
  // A selected node can vanish across a poll/WS refresh. Ignore a stale id so the
  // graph doesn't dim entirely (highlightFor would otherwise light only a dead id).
  const liveSelected = selected && nodeById.has(selected) ? selected : null;
  useEffect(() => {
    if (selected && graph && !nodeById.has(selected)) setSelected(null);
  }, [graph, nodeById, selected]);

  const highlight = useMemo(
    () => (graph ? highlightFor(graph, mode, liveSelected) : null),
    [graph, mode, liveSelected],
  );
  const sel = liveSelected ? nodeById.get(liveSelected) : undefined;
  const relCount = liveSelected
    ? (graph?.edges ?? []).filter((e) => e.source === liveSelected || e.target === liveSelected)
        .length
    : 0;
  const flow = graph && liveSelected ? flowNarrative(graph, liveSelected) : '';

  function pick(next: Mode) {
    setMode(next);
    setSelected(null);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <style>{GRAPH_CSS}</style>
      <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-heading text-base font-medium">Team memory</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                  <span className="pm-pulse inline-block size-1.5 rounded-full bg-[#16a34a]" />
                  Live
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                What PodMan learned · {podId}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={onClose}>
              ← Pods
            </Button>
          </div>

          {/* Toggles */}
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => v && pick(v as Mode)}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="risk">Risk path</ToggleGroupItem>
              <ToggleGroupItem value="learn">Learning edges</ToggleGroupItem>
              <ToggleGroupItem value="all">Whole graph</ToggleGroupItem>
            </ToggleGroup>
            <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
              Drag to rearrange · double-click to release · click to inspect
            </span>
          </div>

          {error && <p className="px-4 py-4 text-sm text-destructive">Graph error: {error}</p>}
          {!graph && !error && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Loading graph…</p>
          )}

          {graph && (
            <>
              {/* Metrics · graph · learning loop */}
              <div className="grid gap-4 p-4 lg:grid-cols-[180px_minmax(0,1fr)_212px]">
                <MetricsRail metrics={graph.metrics} />

                <div className="flex min-h-[440px] flex-col overflow-hidden rounded-xl border bg-card">
                  <GraphCanvas
                    graph={graph}
                    highlight={highlight}
                    selected={liveSelected}
                    onSelect={setSelected}
                  />
                </div>

                {graph.loop?.steps?.length ? <LearningLoop loop={graph.loop} /> : <div />}
              </div>

              {/* Activity stream · selected node */}
              <div className="grid gap-4 border-t px-4 py-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="rounded-xl border bg-card p-4">
                  <ActivityStream events={graph.activity ?? []} />
                </div>
                <div className="rounded-xl border bg-muted/40 p-4">
                  <SelectedNodePanel node={sel} relCount={relCount} flow={flow} mode={mode} />
                </div>
              </div>

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t px-4 py-2.5 text-xs text-muted-foreground">
                {NODE_LEGEND.map((l) => (
                  <span key={l.label} className="flex items-center gap-1.5">
                    <span className="inline-block size-3" style={l.swatch} />
                    {l.label}
                  </span>
                ))}
                <span className="mx-1 h-3 w-px bg-border" aria-hidden />
                {EDGE_LEGEND.map((l) => (
                  <span key={l.label} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-[3px] w-3.5"
                      style={
                        l.dash
                          ? { backgroundImage: `repeating-linear-gradient(90deg, ${l.color} 0 3px, transparent 3px 6px)` }
                          : { background: l.color }
                      }
                    />
                    {l.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
