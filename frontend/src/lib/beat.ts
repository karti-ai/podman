export interface BeatHandle {
  track: MediaStreamTrack;
  stop: () => void;
}

/**
 * Generate a simple 4-on-the-floor beat (kick + hi-hat) as an audio
 * MediaStreamTrack to publish into a LiveKit room. Also routes to the local
 * speakers so the publisher hears it too. Pure Web Audio — no asset/CORS.
 */
export function startBeat(): BeatHandle {
  const ctx = new AudioContext();
  void ctx.resume();
  const dest = ctx.createMediaStreamDestination();
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(dest); // -> published track (remote listeners)
  master.connect(ctx.destination); // -> local speakers (publisher)

  const bpm = 120;
  const spb = 60 / bpm;
  let next = ctx.currentTime + 0.1;
  let beat = 0;

  function kick(time: number, accent: boolean) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(accent ? 180 : 150, time);
    osc.frequency.exponentialRampToValueAtTime(50, time + 0.12);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(accent ? 1 : 0.7, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    osc.connect(g);
    g.connect(master);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  function hat(time: number) {
    const size = Math.floor(ctx.sampleRate * 0.05);
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    noise.connect(hp);
    hp.connect(g);
    g.connect(master);
    noise.start(time);
    noise.stop(time + 0.05);
  }

  const timer = window.setInterval(() => {
    while (next < ctx.currentTime + 0.2) {
      kick(next, beat % 4 === 0);
      hat(next + spb / 2);
      next += spb;
      beat++;
    }
  }, 50);

  const track = dest.stream.getAudioTracks()[0]!;
  return {
    track,
    stop: () => {
      window.clearInterval(timer);
      track.stop();
      void ctx.close();
    },
  };
}
