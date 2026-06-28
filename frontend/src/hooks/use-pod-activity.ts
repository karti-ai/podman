import { useEffect, useMemo, useState } from 'react';
import type { PodActivityEvent } from '@podman/shared';
import { getPodActivity, podActivityStreamUrl } from '../lib/api';

export function usePodActivity(podId: string | null, me: string) {
  const [events, setEvents] = useState<PodActivityEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!podId) return;
    let alive = true;
    const load = async () => {
      try {
        const snapshot = await getPodActivity(podId);
        if (alive) {
          setEvents(snapshot);
          setError(null);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };

    void load();
    const source = new EventSource(podActivityStreamUrl(podId));
    source.addEventListener('open', () => {
      if (alive) setConnected(true);
    });
    source.addEventListener('snapshot', (event) => {
      if (!alive) return;
      setEvents(JSON.parse((event as MessageEvent<string>).data) as PodActivityEvent[]);
      setConnected(true);
      setError(null);
    });
    source.addEventListener('error', () => {
      if (alive) {
        setConnected(false);
        setError('Realtime activity stream reconnecting');
      }
    });

    return () => {
      alive = false;
      source.close();
    };
  }, [podId]);

  return useMemo(() => {
    const mine = events.filter((event) => belongsTo(event, me));
    const team = events.filter((event) => !belongsTo(event, me));
    return { events, mine, team, connected, error };
  }, [connected, error, events, me]);
}

function belongsTo(event: PodActivityEvent, me: string): boolean {
  const normalized = me.trim().toLowerCase();
  if (!normalized) return false;
  const names = [event.actor, ...(event.actors ?? [])]
    .filter(Boolean)
    .map((name) => name!.trim().toLowerCase());
  return names.includes(normalized);
}
