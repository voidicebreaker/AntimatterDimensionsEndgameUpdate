// Pulse replaces the usual production tick, so a one-tick release interval cannot recharge stored time.
// Compare the existing dial settings at a fixed charging rate, including storage caps and the current pulse phase.
export const BlackHolePulseOptimizer = {
  get unavailableReason() {
    if (!ExpansionPack.enslavedPack.isBought || player.disablePostReality) {
      return "Unlock Nameless's Expansion Pack first.";
    }
    if (!Enslaved.isAutoReleasing) return "Turn on Pulse to optimize auto-release.";
    if (!Enslaved.canRelease(true) || !Enslaved.canModifyGameTimeStorage) {
      return "Auto-release and game-time charging must both be available in this Reality.";
    }
    if (ImaginaryUpgrade(24).isLockingMechanics && Ra.isRunning &&
        player.requirementChecks.reality.slowestBH <= 1e-300) {
      return "Stored time release is locked by Imaginary Upgrade 24.";
    }
    return "";
  },

  inputs() {
    const effects = [GAME_SPEED_EFFECT.FIXED_SPEED, GAME_SPEED_EFFECT.TIME_GLYPH, GAME_SPEED_EFFECT.BLACK_HOLE,
      GAME_SPEED_EFFECT.SINGULARITY_MILESTONE, GAME_SPEED_EFFECT.CELESTIAL_MATTER, GAME_SPEED_EFFECT.RA_BUFFS];
    const fullSpeed = getGameSpeedupFactor(effects, false);
    const reducedEffects = [...effects, GAME_SPEED_EFFECT.TIME_STORAGE, GAME_SPEED_EFFECT.NERFS];
    const reducedSpeed = getGameSpeedupFactor(reducedEffects, false);
    const storedSpeed = EndgameUpgrade(7).isBought && !player.disablePostReality
      ? getGameSpeedupFactor() : fullSpeed.sub(reducedSpeed).max(0);
    const tickMs = Enslaved.pulseTickDurationMs || player.options.updateRate * Overclock.timeFlow;
    return {
      stored: player.celestials.enslaved.stored,
      cap: Enslaved.timeCap,
      chargePerTick: storedSpeed.times(tickMs)
        .times(Ra.unlocks.improvedStoredTime.effects.gameTimeAmplification.effectOrDefault(1)),
      normalPerTick: reducedSpeed.times(tickMs),
      tickMs,
      flow: Overclock.timeFlow,
      phase: Enslaved.autoReleaseTick,
      fraction: player.celestials.enslaved.pulseAmount,
      interval: player.celestials.enslaved.pulseTime,
    };
  },

  project(input, { fraction, interval, horizon }) {
    const firstTick = Math.max(1, interval - input.phase);
    const releases = Math.max(0, Math.floor((horizon - firstTick) / interval) + 1);
    let stored = new Decimal(input.stored);
    let released = DC.D0;
    if (releases > 0) {
      if (firstTick > 1) {
        stored = Decimal.min(stored.add(input.chargePerTick.times(firstTick - 1)), input.cap);
      }
      if (interval === 1 && fraction < 1) {
        // An old reservoir can exceed the current cap after changing Realities. Partial releases can then
        // deliver a capped tick repeatedly; releasing everything at once would discard the excess.
        const initialRatio = stored.times(fraction).div(input.cap);
        const cappedTicks = initialRatio.lte(1) ? 0
          : Math.min(releases, Math.ceil(initialRatio.ln().toNumber() / -Math.log1p(-fraction)));
        const remainder = stored.times(Decimal.pow(1 - fraction, cappedTicks));
        const drained = -Math.expm1((releases - cappedTicks) * Math.log1p(-fraction));
        released = new Decimal(input.cap).times(cappedTicks).add(remainder.times(drained));
        stored = stored.times(Decimal.pow(1 - fraction, releases));
        return { released, storedAfter: stored,
          averageSpeed: released.div(horizon * input.tickMs).times(input.flow) };
      }
      if (fraction === 1) {
        // Releasing all stored time maximizes finite-horizon throughput for any fixed interval.
        const perRelease = Decimal.min(input.chargePerTick.times(interval - 1), input.cap);
        released = Decimal.min(stored, input.cap).add(perRelease.times(releases - 1));
        stored = DC.D0;
      } else {
        for (let i = 0; i < releases; i++) {
          released = released.add(Decimal.min(stored.times(fraction), input.cap));
          stored = stored.times(1 - fraction);
          if (i + 1 < releases) {
            stored = Decimal.min(stored.add(input.chargePerTick.times(interval - 1)), input.cap);
          }
        }
      }
      const lastTick = firstTick + (releases - 1) * interval;
      stored = Decimal.min(stored.add(input.chargePerTick.times(horizon - lastTick)), input.cap);
    } else {
      stored = Decimal.min(stored.add(input.chargePerTick.times(horizon)), input.cap);
    }
    const total = released.add(input.normalPerTick.times(horizon - releases));
    return { released, storedAfter: stored, averageSpeed: total.div(horizon * input.tickMs).times(input.flow) };
  },

  sustained(input, fraction, interval) {
    const released = Decimal.min(input.chargePerTick.times(interval - 1), new Decimal(input.cap).times(fraction));
    return released.add(input.normalPerTick.times(interval - 1)).div(interval * input.tickMs).times(input.flow);
  },

  solve(input, mode = "sustained", horizon = 1000) {
    if (!["sustained", "burst"].includes(mode) || ![100, 1000, 10000].includes(horizon)) {
      throw new Error("Invalid auto-release optimizer goal");
    }
    let best;
    const currentStep = Math.clamp(Math.round(input.fraction * 500), 1, 500);
    for (let interval = 1; interval <= 100; interval++) {
      const needed = input.chargePerTick.times(interval - 1).div(input.cap).times(500);
      const minimumStep = needed.gte(500) ? 500 : Math.max(1, needed.ceil().toNumber());
      const fraction = mode === "burst" ? 1 : Math.max(currentStep, minimumStep) / 500;
      const projection = mode === "burst" ? this.project(input, { fraction, interval, horizon }) : null;
      const averageSpeed = projection ? projection.averageSpeed : this.sustained(input, fraction, interval);
      // Prefer the existing interval on ties; otherwise use the shorter interval to reduce release latency.
      const tie = best && averageSpeed.eq(best.averageSpeed) && interval === input.interval;
      if (!best || averageSpeed.gt(best.averageSpeed) || tie) {
        best = { mode, horizon, fraction, interval, averageSpeed, ...projection };
      }
    }
    if (mode === "burst" && new Decimal(input.stored).gt(input.cap)) {
      for (let step = 1; step < 500; step++) {
        const fraction = step / 500;
        const projection = this.project(input, { fraction, interval: 1, horizon });
        if (projection.averageSpeed.gt(best.averageSpeed)) {
          best = { mode, horizon, fraction, interval: 1, ...projection };
        }
      }
    }
    best.currentSpeed = mode === "burst"
      ? this.project(input, { fraction: input.fraction, interval: input.interval, horizon }).averageSpeed
      : this.sustained(input, input.fraction, input.interval);
    return best;
  },

  analyze(mode, horizon) {
    if (this.unavailableReason) return null;
    return this.solve(this.inputs(), mode, horizon);
  },

  apply(mode, horizon) {
    const result = this.analyze(mode, horizon);
    if (!result) return null;
    player.celestials.enslaved.pulseAmount = result.fraction;
    player.celestials.enslaved.pulseTime = result.interval;
    GameUI.update();
    return result;
  },
};
