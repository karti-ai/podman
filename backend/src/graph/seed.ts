import { seedGraph } from './store.js';

/**
 * Seed a pod's continual-learning graph into Mongo (team_model + graph_nodes +
 * graph_edges). Usage: `pnpm graph:seed [podId]` (defaults to demo-pod).
 */
const podId = process.argv[2] ?? 'demo-pod';

seedGraph(podId)
  .then((graph) => {
    console.log(
      `[graph] seeded ${graph.nodes.length} nodes / ${graph.edges.length} edges for pod "${podId}"`,
    );
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error(`[graph] seed failed: ${(err as Error).message}`);
    process.exit(1);
  });
