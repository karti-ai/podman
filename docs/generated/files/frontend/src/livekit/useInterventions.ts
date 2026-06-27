import { useEffect, useState, useCallback } from 'react';
import { RoomEvent, type Room } from 'livekit-client';
import type { DataMessage, Intervention, InterventionStatus } from '@podman/shared';
import { DATA_TOPIC } from '@podman/shared';
import { postOutcome } from '../lib/api';

export function useInterventions(room: Room | null) {
  const [active, setActive] = useState<Intervention | null>(null);

  useEffect(() => {
    if (!room) return;
    const onData = (payload: Uint8Array, _p: unknown, _k: unknown, topic?: string) => {
      if (topic !== DATA_TOPIC) return;
      const msg = JSON.parse(new TextDecoder().decode(payload)) as DataMessage;
      if (msg.type === 'COLLISION') setActive(msg.intervention);
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => { room.off(RoomEvent.DataReceived, onData); };
  }, [room]);

  const respond = useCallback(
    async (status: InterventionStatus, accepted: boolean) => {
      if (!active) return;
      await postOutcome({
        interventionId: active.id,
        collisionId: active.collisionId,
        podId: active.podId,
        wasRealCollision: true,
        accepted,
        recordedAt: new Date().toISOString(),
      });
      setActive(null);
      return status;
    },
    [active],
  );

  return { active, respond };
}
