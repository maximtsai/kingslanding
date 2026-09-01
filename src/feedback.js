// Hero TD -- the presentation layer's ear.
//
// TDD section 17 draws the line like this: "the sim records that things
// happened, and the presentation layer decides what to do about them". Until P6
// nothing stood on the far side of that line. The simulation emitted two dozen
// event types every frame and main.js threw the list away unread, which meant
// the seam the whole architecture was built around had never once been used.
//
// This is the only consumer, and it is deliberately the only one. Everything
// that reacts to something happening -- audio, screen shake, and whatever
// attaches next -- goes through here, so there is exactly one place that knows
// the event vocabulary and exactly one place to look when a sound fires at the
// wrong moment.
//
// It reads world state and never writes to it.
//
// WHY BURSTS ARE THE HARD PART. Events arrive in clumps, not in a trickle: a
// catapult landing in a crowd emits one splash and six unitDied in the same
// tick, and a volley from nine towers emits nine impacts. Two different
// mechanisms handle that, and they are not interchangeable:
//
//   Audio is capped per sound inside audio.js, where a trigger over the cap is
//   dropped. Six deaths become four voices and the mix stays clean.
//
//   Shake is ACCUMULATED and then clamped once per frame, because taking the
//   loudest of six simultaneous impacts is right but adding all six is not --
//   the camera would leave the building.

import { config } from './config.js';

export function createFeedback(world, audio, view, views) {
  const F = config.feedback;
  const V = views || {};

  // Accumulated this frame, applied once at the end of consume().
  let shake = 0;
  const jolt = amount => { shake = Math.max(shake, amount); };

  // The whole vocabulary, in one table. A new event type is a line here.
  const handlers = {
    // ---- shots leaving ----
    shot(e) {
      if (e.kind === 'molotov') { audio.play('molotov'); return; }
      if (!e.fromStructure) { audio.play('enemyBow'); return; }
      audio.play(e.trajectory === 'flat' ? 'ballista' : 'bow');
    },
    // The windup, not the landing: `meleeHit` still fires when the blow
    // connects, so a swing that whiffs is heard starting and never lands.
    swingStart() { audio.play('swing'); },
    enemyShot() { audio.play('enemyBow'); },

    // ---- shots arriving ----
    impact(e) {
      if (e.kind === 'molotov') { audio.play('burningRock'); return; }
      audio.play(e.hit ? 'arrowHit' : 'arrowMiss');
    },
    meleeHit() { audio.play('meleeHit'); },
    spearThrust() { audio.play('spearThrust'); },
    burningRock() { audio.play('burningRock'); jolt(F.shake.burningRock); },
    splash() { audio.play('splash'); jolt(F.shake.splash); },
    reflect() { audio.play('reflect'); },

    // ---- taking damage ----
    // No sound: the shooter's `impact` and the attacker's `meleeHit` already
    // cover the moment, and playing a third voice for the same collision is how
    // a mix turns to mush. This is the visual half only.
    unitHit(e) { if (V.unitView) V.unitView.hit(e.unit, e.source); },

    // ---- casualties ----
    unitDied() { audio.play('unitDied'); },
    // Texture, not an event: see the cap and gain on this one in config.
    footstep() { audio.play('footstep'); },

    // ---- structures ----
    structureHit() { audio.play('structureHit'); },
    structureDestroyed(e) {
      audio.play('structureDown');
      if (V.structureView && V.structureView.demolish) V.structureView.demolish(e.structure);
      // The castle going down is the loudest thing that can happen on the
      // island, and it deserves to be felt rather than merely heard.
      jolt(e.structure && e.structure.kind === 'castle'
        ? F.shake.castleDestroyed : F.shake.structureDestroyed);
    },
    towerBuilt() { audio.play('towerBuilt'); },
    towerUpgraded() { audio.play('towerUpgraded'); },
    towerSold() { audio.play('towerSold'); },
    castlePlaced() { audio.play('castlePlaced'); jolt(F.shake.castlePlaced); },

    // ---- economy ----
    coinCollected() { audio.play('coin'); },
    // The sweep pays out every coin left on the ground at once. One chime per
    // coin would be forty voices; a short rising run of a few reads as "all of
    // them" and costs three.
    coinSweep(e) {
      const chimes = Math.min(F.sweepChimes, e.count);
      for (let k = 0; k < chimes; k++) audio.play('coin', { delay: k * F.sweepChimeGap });
    },

    // ---- the wave loop ----
    boatLanded() { audio.play('boatLanded'); jolt(F.shake.boatLanded); },
    waveStart() { audio.play('waveStart'); },
    // A build phase beginning IS a wave having been cleared -- except the first
    // one, which nobody earned.
    buildPhase() { if (world.waveIndex > 0) audio.play('waveCleared'); },

    // ---- the king ----
    heroHit(e) {
      audio.play('heroHit');
      jolt(F.shake.heroHit);
      if (V.heroView && V.heroView.hit) V.heroView.hit(e.unit);
    },
    heroDied() { audio.play('heroDied'); jolt(F.shake.heroDied); },
    heroRevived() { audio.play('heroRevived'); },

    // ---- endings ----
    lost() { audio.play('defeat'); jolt(F.shake.lost); },
    won() { audio.play('victory'); }
  };

  return {
    // Called once per rendered frame with everything the sim recorded since the
    // last one. Never mutates the list; main.js owns clearing it.
    consume(events) {
      shake = 0;
      for (const event of events) {
        const handler = handlers[event.type];
        if (handler) handler(event);
      }
      if (shake > 0) view.shake(Math.min(shake, F.shake.max));
    },

    // For the UI, which makes noise for reasons the simulation knows nothing
    // about -- a button that did something, or refused to.
    tap() { audio.play('tap'); },
    denied() { audio.play('denied'); }
  };
}
