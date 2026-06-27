# database

Continual-learning memory for PodMan: **MongoDB Atlas** for the team model and
outcomes, **Voyage** embeddings for vector recall. This is what makes PodMan
"more useful the more you use it" (the track requirement).

## Collections

| Collection       | Holds                                          | Notes                         |
| ---------------- | ---------------------------------------------- | ----------------------------- |
| `pods`           | `Pod` docs (members, repo)                     | one per pod                   |
| `observations`   | `EngineerContext` snapshots over time          | sampled, append-only          |
| `collisions`     | detected `Collision`s                          | for replay + precision tuning |
| `interventions`  | `Intervention`s + outcome (accepted/dismissed) | drives the self-tuning policy |
| `memory_vectors` | Voyage embeddings of file/feature notes        | Atlas Vector Search index     |

Types live in [`shared/`](../shared/src). Each engineer/file/feature note is
embedded with Voyage and stored alongside its source doc for retrieval by the
PodMan brain.

## The continual-learning loop

1. **Observe** → write `observations`.
2. **Store** → embed notes into `memory_vectors`.
3. **Predict** → collision detector + brain decide whether to intervene.
4. **Outcome** → update the `interventions` doc with accepted/dismissed.
5. **Adapt** → tune thresholds + ownership attribution from outcomes.

## Setup

Create an Atlas cluster + a Vector Search index on `memory_vectors.embedding`,
then set `MONGODB_URI` and `VOYAGE_API_KEY` in `.env`.
