import { useEffect, useState, useCallback } from 'react';
import { RoomEvent, type Room } from 'livekit-client';
import type { DataMessage, HermesMessage, Intervention, InterventionStatus } from '@podman/shared';
import { DATA_TOPIC } from '@podman/shared';
import { createSyncPr, postOutcome } from '../lib/api';

export function useInterventions(room: Room | null) {
  const [active, setActive] = useState<Intervention | null>(null);
  const [hermes, setHermes] = useState<HermesMessage | null>(null);
  const [voiceCue, setVoiceCue] = useState<string | null>(null);
  const [actionUrl, setActionUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!room) return;
    const onData = (payload: Uint8Array, _p: unknown, _k: unknown, topic?: string) => {
      if (topic !== DATA_TOPIC) return;
      const msg = JSON.parse(new TextDecoder().decode(payload)) as DataMessage;
      if (msg.type === 'COLLISION') {
        setActive(msg.intervention);
        setActionUrl(null);
      }
      if (msg.type === 'HERMES_MESSAGE') setHermes(msg.message);
      if (msg.type === 'VOICE_CUE') setVoiceCue(msg.text);
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room]);

  const respond = useCallback(
    async (status: InterventionStatus, accepted: boolean) => {
      if (!active) return;
      if (accepted && active.suggestedAction.kind === 'open_sync_pr') {
        const pr = await createSyncPr({
          file: String(active.suggestedAction.params?.file ?? ''),
          summary: String(active.suggestedAction.params?.summary ?? active.message),
        });
        setActionUrl(pr.url);
      }
      await postOutcome({
        interventionId: active.id,
        collisionId: active.collisionId,
        podId: active.podId,
        wasRealCollision: true,
        accepted,
        recordedAt: new Date().toISOString(),
      });
      await room?.localParticipant.publishData(
        new TextEncoder().encode(
          JSON.stringify({ type: 'ACK', interventionId: active.id, status }),
        ),
        { reliable: true, topic: DATA_TOPIC },
      );
      setActive(null);
      return status;
    },
    [active, room],
  );

  return { active, hermes, voiceCue, actionUrl, respond };
}
