import type { PodGraph, GraphNodeDoc, GraphEdgeDoc } from '@podman/shared';
import { getDb } from '../memory/db.js';
import { createDemoPodGraph } from './demo.js';

interface TeamModelDoc {
  podId: string;
  graph?: PodGraph;
  updatedAt?: string;
}

/**
 * Load a pod's continual-learning graph. Reads the embedded `team_model.graph`;
 * falls back to a grounded demo graph when none exists yet or Mongo is
 * unreachable — so the demo path never depends on a populated DB.
 */
export async function loadPodGraph(podId: string): Promise<PodGraph> {
  try {
    const db = await getDb();
    const doc = await db.collection<TeamModelDoc>('team_model').findOne({ podId });
    if (doc?.graph) return doc.graph;
  } catch (err) {
    console.warn(`[graph] loadPodGraph fell back to demo: ${(err as Error).message}`);
  }
  return createDemoPodGraph(podId);
}

/**
 * Seed a pod's graph into Mongo: embed it in `team_model` and mirror nodes/edges
 * into `graph_nodes` / `graph_edges` so `$graphLookup` traversal is real, not a
 * mock. Idempotent — safe to run repeatedly.
 */
export async function seedGraph(podId: string): Promise<PodGraph> {
  const db = await getDb();
  const graph = createDemoPodGraph(podId);
  const nodes = db.collection<GraphNodeDoc>('graph_nodes');
  const edges = db.collection<GraphEdgeDoc>('graph_edges');

  await Promise.all([
    nodes.createIndex({ podId: 1, id: 1 }, { unique: true }),
    edges.createIndex({ podId: 1, source: 1 }),
    db.collection('team_model').createIndex({ podId: 1 }, { unique: true }),
  ]);

  await db
    .collection<TeamModelDoc>('team_model')
    .updateOne(
      { podId },
      { $set: { podId, graph, updatedAt: new Date().toISOString() } },
      { upsert: true },
    );

  await Promise.all([nodes.deleteMany({ podId }), edges.deleteMany({ podId })]);
  if (graph.nodes.length) await nodes.insertMany(graph.nodes.map((n) => ({ ...n, podId })));
  if (graph.edges.length) await edges.insertMany(graph.edges.map((e) => ({ ...e, podId })));

  return graph;
}

export interface ReachResult {
  start: string;
  reaches: GraphEdgeDoc[];
}

/**
 * Walk the directed edge chain from a node with MongoDB `$graphLookup` — answers
 * "what does this node's work reach?" (engineer -> file -> collision ->
 * intervention). This is the graph-database traversal that powers the risk path.
 */
export async function reachFrom(podId: string, startNodeId: string): Promise<ReachResult> {
  const db = await getDb();
  const rows = await db
    .collection<GraphEdgeDoc>('graph_edges')
    .aggregate<{ reaches: GraphEdgeDoc[] }>([
      { $match: { podId, source: startNodeId } },
      {
        $graphLookup: {
          from: 'graph_edges',
          startWith: '$target',
          connectFromField: 'target',
          connectToField: 'source',
          as: 'reaches',
          restrictSearchWithMatch: { podId },
        },
      },
    ])
    .toArray();
  return { start: startNodeId, reaches: rows.flatMap((r) => r.reaches) };
}
