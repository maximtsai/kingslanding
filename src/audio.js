// Hero TD -- synthesized audio.
//
// TDD section 19. Everything is generated at runtime with the Web Audio API:
// no sample files, no audio assets, no loading step. That matches the rest of
// the project -- the island has no textures and no imported models either, and
// every material is a handful of numbers -- and it keeps the prototype a pure
// code artifact, where a sound is retuned by changing a constant rather than by
// opening an editor.
//
// FOUR PRIMITIVES COVER THE WHOLE GAME. Every entry in `config.audio.sounds`
// names one of them and supplies its numbers:
//
//   noise   filtered white noise with an exponential decay. Impacts, arrow
//           hits, footsteps, surf. Sweeping the filter down over the decay is
//           what separates a thump from a hiss.
//   blip    an oscillator with a fast pitch envelope. Coins, UI, build
//           complete. Falling pitch reads as negative and rising as positive;
//           keep that consistent and the UI teaches itself.
//   thump   a low sine sweeping ~90Hz to ~40Hz in about 80ms. Tower
//           destruction, boat landing, the castle going down.
//   tone    two or three detuned oscillators sharing an envelope. Bowstring,
//           ballista release, wave horn.
//
// THE THREE RULES THAT MATTER MOST, all from section 19 and all learned the
// expensive way in other projects:
//
//   Voice capping. Forty units dying at once must not fire forty voices.
//   Uncapped synthesis clips into distortion, and that is the characteristic
//   way a prototype like this fails. Caps are per sound, and over the cap a
//   trigger is DROPPED, never queued -- a late sound is worse than no sound.
//
//   Per-trigger randomisation. Identical repeated sounds are what make
//   synthesis read as cheap. Pitch +/-5% and gain +/-10% costs one line each.
//
//   The context starts suspended. Browsers require a user gesture, so audio
//   comes up on the first tap and THE GAME MUST RUN CORRECTLY IF IT NEVER DOES.
//   Every entry point here is a no-op when there is no context, which is why
//   nothing outside this file ever checks whether audio exists.

import { config } from './config.js';

export function createAudio() {
  const A = config.audio;

  let ctx = null;
  let master = null;
  const buses = {};
  let ambient = null;
  let noiseBuffer = null;
  let muted = false;
  let failed = false;
  // 0..1, multiplied into the authored master gain. The options slider drives
  // this; zero is silence, which is why the separate mute button could go.
  let volume = 1;

  // Live voice count per sound name. Incremented on trigger, decremented when
  // the source reports `ended`, so the cap tracks what is actually sounding
  // rather than how often play() was called.
  const voices = new Map();

  function build() {
    if (ctx || failed) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) { failed = true; return null; }
    try {
      ctx = new Ctor();
    } catch (error) {
      // A browser that refuses to give us a context is not a reason to stop
      // running the game.
      failed = true;
      return null;
    }

    master = ctx.createGain();
    master.gain.value = muted ? 0 : A.master * volume;
    master.connect(ctx.destination);

    for (const [name, gain] of Object.entries(A.buses)) {
      const node = ctx.createGain();
      node.gain.value = gain;
      node.connect(master);
      buses[name] = node;
    }

    // One second of white noise, made once and shared by every noise voice.
    // Section 19: never allocate in the frame loop. A BufferSource per trigger
    // is unavoidable and cheap; a fresh buffer per trigger is neither.
    const frames = Math.floor(ctx.sampleRate);
    noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let k = 0; k < frames; k++) data[k] = Math.random() * 2 - 1;

    return ctx;
  }

  // Called from the first real user gesture. Browsers will not start a context
  // any other way, and calling it again later is harmless.
  function resume() {
    const context = build();
    if (!context) return;
    if (context.state === 'suspended') context.resume().catch(() => {});
    if (A.ambient.enabled && !ambient) startAmbient();
  }

  const vary = amount => 1 + (Math.random() * 2 - 1) * amount;

  // Claim a voice slot, or report that this trigger should be dropped.
  function claim(name, cap) {
    const live = voices.get(name) || 0;
    if (live >= (cap || A.defaultVoiceCap)) return false;
    voices.set(name, live + 1);
    return true;
  }
  function release(name) {
    voices.set(name, Math.max(0, (voices.get(name) || 1) - 1));
  }

  function busFor(spec) {
    return buses[spec.bus] || buses.sfx || master;
  }

  // ---- the four primitives ------------------------------------------------
  // Each takes the sound's config entry and a gain already scaled by the
  // caller, wires itself up, and frees itself on `ended`.

  function playNoise(spec, gain, when) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    // Offset into the shared buffer, so two hits in the same frame are not
    // literally the same waveform.
    const offset = Math.random() * (noiseBuffer.duration - spec.duration - 0.01);

    const filter = ctx.createBiquadFilter();
    filter.type = spec.filter || 'lowpass';
    filter.Q.value = spec.q || 1;
    const from = spec.freq * vary(A.pitchVariance);
    filter.frequency.setValueAtTime(from, when);
    if (spec.sweepTo) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(40, spec.sweepTo * vary(A.pitchVariance)), when + spec.duration);
    }

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(gain, when + (spec.attack || 0.004));
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + spec.duration);

    source.connect(filter).connect(envelope).connect(busFor(spec));
    source.start(when, Math.max(0, offset));
    source.stop(when + spec.duration + 0.02);
    return source;
  }

  function playBlip(spec, gain, when) {
    const osc = ctx.createOscillator();
    osc.type = spec.wave || 'triangle';
    const pitch = vary(A.pitchVariance);
    osc.frequency.setValueAtTime(spec.freq * pitch, when);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(30, (spec.to || spec.freq) * pitch), when + spec.duration);

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(gain, when + (spec.attack || 0.006));
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + spec.duration);

    osc.connect(envelope).connect(busFor(spec));
    osc.start(when);
    osc.stop(when + spec.duration + 0.02);
    return osc;
  }

  function playThump(spec, gain, when) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const pitch = vary(A.pitchVariance);
    osc.frequency.setValueAtTime((spec.freq || 90) * pitch, when);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, (spec.to || 40) * pitch), when + spec.duration);

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(gain, when + (spec.attack || 0.005));
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + spec.duration);

    osc.connect(envelope).connect(busFor(spec));
    osc.start(when);
    osc.stop(when + spec.duration + 0.02);
    return osc;
  }

  function playTone(spec, gain, when) {
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(gain, when + (spec.attack || 0.008));
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + spec.duration);
    envelope.connect(busFor(spec));

    const pitch = vary(A.pitchVariance);
    const partials = spec.partials || 2;
    let last = null;
    for (let k = 0; k < partials; k++) {
      const osc = ctx.createOscillator();
      osc.type = spec.wave || 'sawtooth';
      osc.frequency.setValueAtTime(spec.freq * pitch, when);
      if (spec.to) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(30, spec.to * pitch), when + spec.duration);
      }
      // Detune in cents, spread either side of centre. This is the whole
      // difference between "an oscillator" and "an instrument".
      osc.detune.value = (k - (partials - 1) / 2) * (spec.detune || 8);
      osc.connect(envelope);
      osc.start(when);
      osc.stop(when + spec.duration + 0.02);
      last = osc;
    }
    return last;
  }

  const primitives = { noise: playNoise, blip: playBlip, thump: playThump, tone: playTone };

  // Always ramped, never stepped: a gain jumping to a new value clicks, and a
  // slider being dragged would click on every input event.
  function applyGain() {
    if (!master || !ctx) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(
      muted ? 0 : A.master * volume, ctx.currentTime, 0.02);
  }

  // ---- the one entry point ------------------------------------------------
  // Deliberately total: an unknown name, a dead context, a muted game or a
  // capped-out sound all return quietly. Callers never branch on audio.
  function play(name, options) {
    if (muted || volume <= 0 || failed || !ctx || ctx.state !== 'running') return;
    const spec = A.sounds[name];
    if (!spec) return;
    const make = primitives[spec.kind];
    if (!make) return;
    if (!claim(name, spec.cap)) return;

    const gain = Math.max(0.0001,
      spec.gain * vary(A.gainVariance) * ((options && options.gain) || 1));
    const when = ctx.currentTime + ((options && options.delay) || 0);

    let node = null;
    try {
      node = make(spec, gain, when);
    } catch (error) {
      release(name);
      return;
    }
    if (node) node.onended = () => release(name);
    else release(name);
  }

  // ---- ambient surf -------------------------------------------------------
  // Section 19 wants this early: near-silence makes everything else sound
  // thinner than it is. One filtered noise loop with a slow gain wander, which
  // is enough to stop it reading as a flat hiss.
  function startAmbient() {
    if (!ctx || ambient) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = A.ambient.cutoff;
    filter.Q.value = 0.6;

    const gain = ctx.createGain();
    gain.gain.value = A.ambient.gain;

    // A slow LFO on the gain: the swell of surf, not a tremolo.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = A.ambient.swellRate;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = A.ambient.gain * A.ambient.swellDepth;
    lfo.connect(lfoDepth).connect(gain.gain);

    source.connect(filter).connect(gain).connect(buses.ambient || master);
    source.start();
    lfo.start();
    ambient = { source, lfo, gain };
  }

  return {
    resume,
    play,

    get available() { return !!ctx && !failed; },
    get running() { return !!ctx && ctx.state === 'running'; },
    get muted() { return muted; },
    // The live graph, for the dev overlay and for measuring that this file
    // actually makes a sound rather than merely believing it did. Null until
    // the first gesture builds it.
    get context() { return ctx; },
    get output() { return master; },
    // Live voice counts per sound, so a cap that is set too low shows up as a
    // number rather than as a sound that mysteriously does not play.
    get voices() { return new Map(voices); },

    get volume() { return volume; },

    setMuted(value) {
      muted = !!value;
      applyGain();
      return muted;
    },

    // 0..1. Silence at zero, so this subsumes muting entirely.
    setVolume(value) {
      volume = Math.max(0, Math.min(1, Number(value) || 0));
      applyGain();
      return volume;
    },

    // A level change disposes the world; the audio context outlives it, so the
    // only thing to reset is the voice bookkeeping, which would otherwise leak
    // slots for sounds whose `ended` never arrives because the tab was hidden.
    reset() { voices.clear(); },

    dispose() {
      if (!ctx) return;
      try {
        if (ambient) { ambient.source.stop(); ambient.lfo.stop(); ambient = null; }
        ctx.close();
      } catch (error) { /* closing a dead context is not worth a crash */ }
      ctx = null;
    }
  };
}
