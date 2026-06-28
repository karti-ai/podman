import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI!;
const DB = 'podman';

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB);

  await db.collection('pods').createIndex({ id: 1 }, { unique: true });
  // High-volume observations expire after 6h to keep the cluster light.
  await db.collection('observations').createIndex({ observedAt: 1 }, { expireAfterSeconds: 21600 });
  await db.collection('observations').createIndex({ podId: 1, engineerId: 1 });
  await db.collection('collisions').createIndex({ podId: 1, detectedAt: -1 });
  await db.collection('interventions').createIndex({ id: 1 }, { unique: true });
  await db.collection('team_model').createIndex({ podId: 1 }, { unique: true });
  await db.collection('policy').createIndex({ pattern: 1 }, { unique: true });

  // Atlas Vector Search index for collision-pattern recall (Voyage voyage-3 = 1024 dims).
  try {
    await db.command({
      createSearchIndexes: 'memory_vectors',
      indexes: [
        {
          name: 'vector_index',
          type: 'vectorSearch',
          definition: {
            fields: [
              { type: 'vector', path: 'embedding', numDimensions: 1024, similarity: 'cosine' },
            ],
          },
        },
      ],
    });
  } catch (e) {
    console.warn('vector index (create in Atlas UI if this errors):', (e as Error).message);
  }

  console.log('PodMan DB initialized.');
  await client.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
