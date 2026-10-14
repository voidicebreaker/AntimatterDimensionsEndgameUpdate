// Brute-forces every legal multiset of equippable glyph types by running the real game loop on a copy of the save.
// Slot order never matters (effects combine per type), so a loadout is just a count per type. Each trial restores the
// same starting state, equips its glyphs into empty slots, simulates a fixed span of real time with the player's own
// autobuyers and automator, and records the resulting resources. The live save is restored when the run ends.
const SOLVER_TYPES = ["power", "infinity", "replication", "time", "dilation", "effarig", "reality"];
const TYPE_LETTERS = {
  power: "P", infinity: "I", replication: "R", time: "T", dilation: "D", effarig: "E", reality: "Y"
};

const decimalMetric = (key, name, getter) => ({ key, name, value: getter, lowerIsBetter: false });
const timeMetric = (key, name) => ({ key, name, value: run => run.milestones[key], lowerIsBetter: true, isTime: true });

export const GLYPH_SOLVER_METRICS = [
  decimalMetric("antimatter", "Antimatter", () => Currency.antimatter.value),
  decimalMetric("ip", "Infinity Points", () => Currency.infinityPoints.value),
  decimalMetric("ep", "Eternity Points", () => Currency.eternityPoints.value),
  decimalMetric("rm", "Reality Machines", () => Currency.realityMachines.value),
  decimalMetric("im", "Imaginary Machines", () => Currency.imaginaryMachines.value),
  decimalMetric("tt", "Time Theorems", () => Currency.timeTheorems.value.add(TimeTheorems.calculateTimeStudiesCost())),
  decimalMetric("tp", "Tachyon Particles", () => Currency.tachyonParticles.value),
  decimalMetric("dt", "Dilated Time", () => Currency.dilatedTime.value),
  decimalMetric("infinities", "Infinities", () => Currency.infinitiesTotal.value),
  decimalMetric("eternities", "Eternities", () => Currency.eternities.value),
  decimalMetric("realities", "Realities", () => Currency.realities.value),
  decimalMetric("celestialPoints", "Celestial Points", () => Currency.celestialPoints.value),
  decimalMetric("galacticPower", "Galactic Power", () => Currency.galacticPower.value),
  decimalMetric("celestialMatter", "Celestial Matter", () => Currency.celestialMatter.value),
  decimalMetric("etherealPower", "Ethereal Power", () => Currency.etherealPower.value),
  decimalMetric("darkMatter", "Dark Matter", () => Currency.darkMatter.value),
  decimalMetric("darkEnergy", "Dark Energy", () => Currency.darkEnergy.value),
  decimalMetric("singularities", "Singularities", () => Currency.singularities.value),
  decimalMetric("raMemories", "Ra Memories", () => Ra.pets.all.map(pet => new Decimal(pet.memories))
    .reduce((a, b) => a.add(b), DC.D0)),
  timeMetric("firstInfinity", "Time to Infinity"),
  timeMetric("firstEternity", "Time to Eternity"),
  timeMetric("firstReality", "Time to Reality"),
];

function readMetric(metric, run) {
  try {
    const value = metric.value(run);
    if (metric.isTime) return value;
    return new Decimal(value);
  } catch {
    return metric.isTime ? null : DC.D0;
  }
}

// Positive when a is better than b. Unreached milestones (null) rank below every reached one.
export function compareGlyphSolverMetric(metric, a, b) {
  if (metric.isTime) {
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    return b - a;
  }
  return Decimal.compare(a, b);
}

const glyphPower = glyph => new Decimal(glyph.level).times(glyph.strength);
const sameGlyph = (a, b) => new Decimal(a.level).eq(b.level) && a.strength === b.strength && a.effects === b.effects;

export const GlyphSolver = {
  // Stand-in Effarig and Reality glyphs created by the pool, which have to be made real before equipping
  synthesized: new WeakSet(),
  settings: {
    seconds: 600,
    // Late-game ticks cost roughly 0.1 s each, so a full 406-loadout search at these settings takes about 25 minutes
    screenTicks: 30,
    refineTicks: 300,
    refineCount: 10,
    target: "antimatter",
    useTimeFlow: true,
    forceRestart: false,
    excluded: [],
  },
  // Plain data for the UI to copy; results persist until the next run or a page reload
  status: {
    running: false,
    cancelRequested: false,
    phase: "",
    done: 0,
    total: 0,
    startedAt: 0,
    error: "",
    lastRun: null,
  },

  get unavailableReason() {
    if (Alpha.isRunning || player.disablePostReality) {
      return "Glyphs are disabled in this run. Exit Alpha (or the current special run) first.";
    }
    if (GameEnd.creditsEverClosed) return "The game has ended.";
    if (Pelle.isDisabled("glyphs")) return "Glyphs are disabled while Doomed.";
    if (this.freeSlotCount === 0) return "You have no Glyph slots to fill.";
    const locks = [RealityUpgrade(9), RealityUpgrade(24), ImaginaryUpgrade(25), DualityUpgrade(22)];
    if (locks.some(upgrade => upgrade.isLockingMechanics)) {
      return "An upgrade requirement that restricts Glyphs is being attempted; pause it first.";
    }
    if (this.loadoutCount === 0) return "None of the allowed Glyph types are in your inventory.";
    return "";
  },

  get companionSlots() {
    return player.reality.glyphs.active.filter(g => g.type === "companion").length;
  },

  get freeSlotCount() {
    return Math.max(Glyphs.activeSlotCount - this.companionSlots, 0);
  },

  // Mirrors the special glyph limit enforced in Glyphs.equip
  get maxSpecialGlyphs() {
    if (Slabdrill.isCursed) return 0;
    return Achievement(196).isUnlocked && !player.disablePostReality ? 2 : 1;
  },

  // Every glyph the solver may equip, including ones currently equipped (they return to the pool on a restart)
  get ownedGlyphs() {
    return player.reality.glyphs.inventory.concat(player.reality.glyphs.active.filter(g => g.type !== "companion"));
  },

  // Effarig and Reality glyphs are cheap to get on demand (pick one on a Reality, or press the Alchemy button), so any
  // the player is missing are stood in for by the best one they could make. Returns a fresh, unowned glyph or null.
  synthesizeGlyph(type) {
    if (type === "reality") {
      const level = Decimal.floor(AlchemyResource.reality.amount);
      return AlchemyResource.reality.isUnlocked && level.gte(1) ? GlyphGenerator.realityGlyph(level) : null;
    }
    if (type === "effarig") {
      // An all-effect Effarig glyph at the level and rarity of the best basic glyph owned
      const glyph = GlyphGenerator.endgameGlyph("effarig");
      const best = this.ownedGlyphs.filter(g => BASIC_GLYPH_TYPES.includes(g.type))
        .sort((a, b) => Decimal.compare(glyphPower(b), glyphPower(a)))[0];
      if (best) {
        glyph.level = new Decimal(best.level);
        glyph.rawLevel = new Decimal(best.rawLevel ?? best.level);
        glyph.strength = best.strength;
      }
      return glyph;
    }
    return null;
  },

  // For each type: how many may be equipped and which glyphs would be used, best first
  get pool() {
    const slots = this.freeSlotCount;
    const owned = this.ownedGlyphs;
    return SOLVER_TYPES.map(type => {
      const isSpecial = type === "effarig" || type === "reality";
      const typeLimit = isSpecial ? this.maxSpecialGlyphs : slots;
      const ownedOfType = owned.filter(g => g.type === type);
      const candidates = [...ownedOfType];
      if (isSpecial) {
        for (let i = 0; i < typeLimit; i++) {
          const glyph = this.synthesizeGlyph(type);
          if (!glyph) break;
          this.synthesized.add(glyph);
          candidates.push(glyph);
        }
      }
      candidates.sort((a, b) => Decimal.compare(glyphPower(b), glyphPower(a)) ||
        countValuesFromBitmask(b.effects) - countValuesFromBitmask(a.effects));
      let cap = Math.min(candidates.length, typeLimit, slots);
      if (Pelle.isGlyphTypeDisabled(type) || this.settings.excluded.includes(type)) cap = 0;
      const used = candidates.slice(0, cap);
      return {
        type,
        letter: TYPE_LETTERS[type],
        owned: ownedOfType.length,
        synthesized: used.filter(g => this.synthesized.has(g)).length,
        cap,
        excluded: this.settings.excluded.includes(type),
        // If the glyphs we would equip are not identical, the result depends on which ones we picked
        isUniform: used.every(g => sameGlyph(g, used[0])),
        glyphs: used,
      };
    });
  },

  // All count vectors over the pool which exactly fill the free slots
  loadouts(pool = this.pool) {
    const slots = this.freeSlotCount;
    const results = [];
    const counts = new Array(pool.length).fill(0);
    const recurse = (index, left) => {
      if (index === pool.length) {
        if (left === 0) results.push([...counts]);
        return;
      }
      for (let n = Math.min(pool[index].cap, left); n >= 0; n--) {
        counts[index] = n;
        recurse(index + 1, left - n);
      }
      counts[index] = 0;
    };
    if (slots > 0) recurse(0, slots);
    return results;
  },

  get loadoutCount() {
    return this.loadouts().length;
  },

  describe(counts) {
    return SOLVER_TYPES.map((type, i) => TYPE_LETTERS[type].repeat(counts[i])).join("");
  },

  // Replacing an equipped glyph restarts the Reality (see Glyphs.swapIntoActive); this does the same restart with all
  // non-Companion glyphs moved back to the inventory. Returns false if there was no room to unequip them.
  restartWithoutGlyphs() {
    for (const glyph of [...player.reality.glyphs.active]) {
      if (glyph.type === "companion") continue;
      const index = Glyphs.findFreeIndex(player.options.respecIntoProtected);
      const fallback = Glyphs.findFreeIndex(!player.options.respecIntoProtected);
      if (index < 0 && fallback < 0) return false;
      Glyphs.unequip(glyph.idx, index < 0 ? fallback : index);
    }
    if (Slabdrill.isCursed) {
      Slabdrill.enterCore(true);
      Slabdrill.exitCore();
    } else {
      finishProcessReality({
        reset: true,
        glyphUndo: false,
        restoreCelestialState: true,
      });
    }
    return true;
  },

  get needsRestart() {
    const hasEquipped = player.reality.glyphs.active.some(g => g.type !== "companion");
    return hasEquipped || (this.settings.forceRestart && PlayerProgress.realityUnlocked());
  },

  // Directly equips the loadout into empty slots, as Glyphs.equip would, without its modals
  equipLoadout(counts) {
    const pool = this.pool;
    const freeSlots = [];
    for (let slot = 0; slot < Glyphs.activeSlotCount; slot++) {
      if (!Glyphs.active[slot]) freeSlots.push(slot);
    }
    pool.forEach((entry, i) => {
      for (const glyph of entry.glyphs.slice(0, counts[i])) {
        if (this.synthesized.has(glyph)) Glyphs.addToInventory(glyph);
        if (!player.reality.glyphs.inventory.includes(glyph)) throw new Error("No inventory space for a trial Glyph.");
        Glyphs.removeFromInventory(glyph);
        glyph.idx = freeSlots.shift();
        player.reality.glyphs.active.push(glyph);
      }
    });
    Glyphs.refreshActive();
    Glyphs.updateRealityGlyphEffects();
    Glyphs.updateMaxGlyphCount();
    EventHub.dispatch(GAME_EVENT.GLYPHS_EQUIPPED_CHANGED);
    EventHub.dispatch(GAME_EVENT.GLYPHS_CHANGED);
  },

  async runTrial(base, counts, { seconds, realSeconds, ticks }) {
    SolverHarness.restoreTrial(base);
    this.equipLoadout(counts);
    player.reality.respec = false;

    // Milestones are in the player's real time, before Overclock time flow is applied
    const run = { milestones: { firstInfinity: null, firstEternity: null, firstReality: null } };
    let elapsed = 0;
    const mark = key => () => {
      if (run.milestones[key] === null) run.milestones[key] = elapsed;
    };
    EventHub.logic.on(GAME_EVENT.BIG_CRUNCH_AFTER, mark("firstInfinity"), this);
    EventHub.logic.on(GAME_EVENT.ETERNITY_RESET_AFTER, mark("firstEternity"), this);
    EventHub.logic.on(GAME_EVENT.REALITY_RESET_AFTER, mark("firstReality"), this);
    try {
      const outcome = await SolverHarness.runTicks({
        seconds,
        ticks,
        onStep: fraction => {
          elapsed = realSeconds * fraction;
        },
        isCancelled: () => this.status.cancelRequested,
      });
      if (outcome === "cancelled") return null;
      const values = {};
      for (const metric of GLYPH_SOLVER_METRICS) values[metric.key] = readMetric(metric, run);
      return values;
    } finally {
      EventHub.logic.offAll(this);
    }
  },

  rank(results) {
    const metric = GLYPH_SOLVER_METRICS.find(m => m.key === this.settings.target) ?? GLYPH_SOLVER_METRICS[0];
    return [...results].sort((a, b) => compareGlyphSolverMetric(metric, b.values[metric.key], a.values[metric.key]));
  },

  async solve() {
    if (this.status.running || SolverHarness.isBusy || this.unavailableReason) return;
    const settings = { ...this.settings, excluded: [...this.settings.excluded] };
    const pool = this.pool;
    const loadouts = this.loadouts(pool);
    const seconds = settings.seconds * (settings.useTimeFlow ? Overclock.timeFlow : 1);
    const refineCount = Math.min(settings.refineTicks > settings.screenTicks ? settings.refineCount : 0,
      loadouts.length);

    const session = SolverHarness.begin("glyphs");
    if (!session) return;
    Object.assign(this.status, {
      running: true, cancelRequested: false, phase: "Preparing", done: 0,
      total: loadouts.length + refineCount, startedAt: Date.now(), error: "",
    });
    let results = [];
    try {
      if (this.needsRestart && !this.restartWithoutGlyphs()) {
        throw new Error("There is no inventory space to unequip your current Glyphs.");
      }
      const base = GameSaveSerializer.serialize(player);

      this.status.phase = "Screening";
      for (const counts of loadouts) {
        const values = await this.runTrial(base, counts,
          { seconds, realSeconds: settings.seconds, ticks: settings.screenTicks });
        if (values === null) break;
        results.push({ counts, name: this.describe(counts), values, ticks: settings.screenTicks });
        this.status.done++;
      }

      if (!this.status.cancelRequested && refineCount > 0) {
        this.status.phase = "Refining";
        const ranked = this.rank(results).slice(0, refineCount);
        for (const result of ranked) {
          const values = await this.runTrial(base, result.counts,
            { seconds, realSeconds: settings.seconds, ticks: settings.refineTicks });
          if (values === null) break;
          result.values = values;
          result.ticks = settings.refineTicks;
          this.status.done++;
        }
      }
    } catch (error) {
      this.status.error = error.message || String(error);
      // eslint-disable-next-line no-console
      console.error(error);
    } finally {
      const restoreError = SolverHarness.end(session);
      if (restoreError) this.status.error = restoreError;
      results = this.rank(results);
      // Frozen so the UI does not make hundreds of result objects reactive
      this.status.lastRun = Object.freeze({
        settings,
        seconds,
        cancelled: this.status.cancelRequested,
        pool: pool.map(p => ({ type: p.type, letter: p.letter, cap: p.cap, owned: p.owned, isUniform: p.isUniform })),
        results,
        finishedAt: Date.now(),
      });
      this.status.running = false;
      this.status.phase = "";
    }
  },

  cancel() {
    if (this.status.running) this.status.cancelRequested = true;
  },

  // Equips a solved loadout for real, restarting the Reality first if any glyph is already equipped
  apply(counts) {
    if (this.status.running || SolverHarness.isBusy || this.unavailableReason) return false;
    if (player.reality.glyphs.active.some(g => g.type !== "companion") && !this.restartWithoutGlyphs()) {
      GameUI.notify.error("No inventory space to unequip your current Glyphs.");
      return false;
    }
    const pool = this.pool;
    if (pool.some((entry, i) => entry.glyphs.length < counts[i])) {
      GameUI.notify.error("You no longer own the Glyphs for that loadout.");
      return false;
    }
    const chosen = pool.flatMap((entry, i) => entry.glyphs.slice(0, counts[i]));
    const missingEffarig = chosen.filter(g => g.type === "effarig" && this.synthesized.has(g)).length;
    const canCreateReality = ExpansionPack.effarigPack.isBought && !player.disablePostReality;
    let missingReality = 0;
    for (const glyph of chosen) {
      if (!this.synthesized.has(glyph)) {
        const slot = Glyphs.active.indexOf(null);
        if (slot >= 0) Glyphs.equip(glyph, slot);
      } else if (glyph.type === "reality" && canCreateReality) {
        // Same as the Alchemy tab's free Reality Glyph button once Effarig's Expansion Pack is bought
        Glyphs.addToInventory(glyph);
        player.reality.glyphs.createdRealityGlyph = true;
        const slot = Glyphs.active.indexOf(null);
        if (slot >= 0 && player.reality.glyphs.inventory.includes(glyph)) Glyphs.equip(glyph, slot);
      } else if (glyph.type === "reality") {
        missingReality++;
      }
    }
    const missing = [];
    if (missingEffarig) missing.push(quantifyInt("Effarig Glyph", missingEffarig));
    if (missingReality) missing.push(quantifyInt("Reality Glyph", missingReality));
    if (missing.length) GameUI.notify.info(`Get ${missing.join(" and ")} to finish this loadout.`, 6000);
    return true;
  },
};
