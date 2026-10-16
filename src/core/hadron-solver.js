// Tries every Light / Dark (or Exotic) Hadron split by running the real game loop on copies of the save. Each trial
// makes the switch with the same reset the Hadrons pane uses, lets the player's own automation rebuild for a while,
// records the resulting resources, then runs Auto Lai'tela to see how far each split can destabilize and Hadronize.
import { compareGlyphSolverMetric, GLYPH_SOLVER_METRICS } from "./glyph-solver";
import { SolverPool } from "./solver-pool";

// The choice that keeps the current split, which is the only one that skips the reset
export const HADRON_SOLVER_KEEP = "keep";
// Lai'tela runs are decided within seconds, so its phase is simulated at a fixed resolution
const LAITELA_TICKS_PER_SECOND = 10;
const MAX_LAITELA_TICKS = 20000;

// Switching throws away Dark Matter, its annihilation multiplier, Dark Matter Dimension ascensions and Singularities,
// which take a long time to build back up; each trial records when these pass what the live save had before switching
export const HADRON_SOLVER_RECOVERY = [
  { key: "darkMatter", name: "Dark Matter", value: () => Currency.darkMatter.value },
  { key: "annihilation", name: "Annihilation multiplier", value: () => Laitela.darkMatterMult },
  { key: "singularities", name: "Singularities", value: () => Currency.singularities.value },
];

const decimalMetric = (key, name, getter) => ({ key, name, value: getter, lowerIsBetter: false });

// Read once the rebuild phase ends, before Lai'tela's Reality changes what the run looks like
const RESOURCE_METRICS = [
  decimalMetric("continuum", "Continuum multiplier", () => Laitela.matterExtraPurchaseFactor),
  ...GLYPH_SOLVER_METRICS.filter(metric => !metric.isTime),
];

export const HADRON_SOLVER_METRICS = [
  decimalMetric("laitelaProgress", "Lai'tela progress (Dimensions destabilized)", run => run.progress),
  decimalMetric("hadronizes", "Hadronizes gained", run => run.hadronizes),
  ...RESOURCE_METRICS,
];

function readMetric(metric, run) {
  try {
    return new Decimal(metric.value(run));
  } catch {
    return DC.D0;
  }
}

export const HadronSolver = {
  settings: {
    // Real seconds the player's automation gets to rebuild after the reset, before resources are recorded
    rebuildSeconds: 1800,
    rebuildTicks: 180,
    // Real seconds of Auto Lai'tela per trial; a split which walls stops as soon as Auto Lai'tela gives up
    laitelaSeconds: 300,
    // The best few splits are run again with this many times as long in Lai'tela, to confirm the ranking holds
    confirmFactor: 2,
    confirmCount: 3,
    // Hadron effects grow with real time spent in the Endgame; this starts every trial at zero instead of now
    freshEndgame: false,
    useTimeFlow: true,
    // Web Workers to run trials on; 0 runs them on the page itself, pausing the game
    workers: SolverPool.defaultSize,
    target: "laitelaProgress",
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
    note: "",
    parallel: false,
    workers: 0,
    lastRun: null,
  },

  get unavailableReason() {
    if (!Laitela.isUnlocked) return "Unlock Lai'tela first.";
    if (!DualityUpgrade(19).isBought) return "Hadrons can only be split once Dark Hadrons are unlocked.";
    if (Pelle.isDoomed || Slabdrill.isCursed || player.disablePostReality) {
      return "Hadrons cannot be reassigned in this run.";
    }
    if (GameEnd.creditsEverClosed) return "The game has ended.";
    if (Hadrons.hadrons.total === 0) return "You have no Hadrons to split.";
    return "";
  },

  get canUseWorkers() {
    return SolverPool.isSupported && this.settings.workers > 0;
  },

  // Every split worth trying; the current one is the "keep" choice, since choosing it again would not reset anything
  get choices() {
    return [HADRON_SOLVER_KEEP, ...Hadrons.splits.filter(split => split !== Hadrons.split)];
  },

  describeChoice(choice, run = this.status.lastRun) {
    const usesExotic = run?.usesExotic ?? Hadrons.usesExotic;
    const total = run?.total ?? Hadrons.hadrons.total;
    const current = run?.current ?? Hadrons.split;
    if (choice === HADRON_SOLVER_KEEP) {
      return `${Hadrons.describeSplit(current, usesExotic, total)} (current, no reset)`;
    }
    return Hadrons.describeSplit(choice, usesExotic, total);
  },

  // Turns the live save into the state every trial starts from
  prepareBase() {
    if (this.settings.freshEndgame) player.records.thisEndgame.realTime = 0;
    // Auto Lai'tela refuses to start alongside the EC scheduler, and both would fight over Realities
    if (ECScheduler.isRunning) ECScheduler.data.running = false;
    AutoLaitela.stop("");
  },

  trialOptions(settings, laitelaFactor = 1) {
    const flow = settings.useTimeFlow ? Overclock.timeFlow : 1;
    const laitelaSeconds = settings.laitelaSeconds * laitelaFactor;
    return {
      rebuildSeconds: settings.rebuildSeconds * flow,
      rebuildTicks: settings.rebuildTicks,
      laitelaSeconds: laitelaSeconds * flow,
      laitelaTicks: Math.clampMax(Math.ceil(laitelaSeconds * flow * LAITELA_TICKS_PER_SECOND), MAX_LAITELA_TICKS),
    };
  },

  async runTrial(base, choice, { rebuildSeconds, rebuildTicks, laitelaSeconds, laitelaTicks }) {
    SolverHarness.restoreTrial(base);
    AutoLaitela.stop("");
    const isCancelled = () => this.status.cancelRequested;
    const before = HADRON_SOLVER_RECOVERY.map(resource => resource.value());
    if (choice !== HADRON_SOLVER_KEEP && !Hadrons.setSplit(choice)) {
      throw new Error(`Could not switch to ${Hadrons.describeSplit(choice)}.`);
    }

    // Seconds into the rebuild at which each resource got back to its value before switching, or null if it did not
    const recoveredAt = {};
    const checkRecovery = elapsed => HADRON_SOLVER_RECOVERY.forEach((resource, i) => {
      if (recoveredAt[resource.key] === undefined && resource.value().gte(before[i])) {
        recoveredAt[resource.key] = elapsed;
      }
    });
    checkRecovery(0);
    // Uniform ticks: Lai'tela's 30 second rule and the Singularity autobuyers run on real time, which the Black Hole
    // stepper would lump into a handful of huge ticks
    const rebuild = await SolverHarness.runTicks({
      seconds: rebuildSeconds,
      ticks: rebuildTicks,
      uniform: true,
      onStep: fraction => checkRecovery(rebuildSeconds * fraction),
      isCancelled,
    });
    if (rebuild === "cancelled") return null;
    for (const resource of HADRON_SOLVER_RECOVERY) recoveredAt[resource.key] ??= null;
    const values = {};
    for (const metric of RESOURCE_METRICS) values[metric.key] = readMetric(metric);

    const startTier = Laitela.difficultyTier;
    const startHadronizes = Laitela.hadronizes;
    let laitelaTime = 0;
    // "running" if still destabilizing at the end, "walled" if a run became too slow, otherwise "stopped" with a note
    let laitelaOutcome = "stopped";
    let note = "";
    AutoLaitela.allowInSimulation = true;
    try {
      AutoLaitela.start();
      if (AutoLaitela.isActive) {
        const outcome = await SolverHarness.runTicks({
          seconds: laitelaSeconds,
          ticks: laitelaTicks,
          uniform: true,
          onStep: fraction => {
            laitelaTime = laitelaSeconds * fraction;
            return !AutoLaitela.isActive;
          },
          isCancelled,
        });
        if (outcome === "cancelled") return null;
        if (AutoLaitela.isActive) {
          laitelaOutcome = "running";
        } else if (Laitela.isRunning || player.celestials.laitela.thisCompletion >= 30) {
          // Auto Lai'tela leaves the player in a run once it passes 30 seconds, or stops after one that took that long
          laitelaOutcome = "walled";
        } else {
          note = AutoLaitela.status.replace(/^Stopped: /u, "");
        }
      } else {
        note = `Auto Lai'tela could not start: ${AutoLaitela.unavailableReason}`;
      }
    } finally {
      AutoLaitela.allowInSimulation = false;
      AutoLaitela.stop("");
    }
    const hadronizes = Laitela.hadronizes - startHadronizes;
    const run = { hadronizes, progress: 8 * hadronizes + Laitela.difficultyTier - startTier };
    values.laitelaProgress = readMetric(HADRON_SOLVER_METRICS[0], run);
    values.hadronizes = readMetric(HADRON_SOLVER_METRICS[1], run);
    return {
      values,
      recoveredAt,
      laitelaOutcome,
      note,
      laitelaTime,
      dimensionsLeft: Laitela.maxAllowedDimension,
      // What the run it stopped in needed, against what it reached, to show how far a walled split is from the wall
      antimatterNeeded: Laitela.antimatterNeededToDestabilize,
      antimatterReached: Currency.antimatter.value,
    };
  },

  async solve() {
    if (this.status.running || SolverHarness.isBusy || this.unavailableReason) return;
    if (this.canUseWorkers) await this.solveParallel();
    else await this.solveSingleThread();
  },

  // Everything a solve needs that does not depend on where its trials run
  solveContext() {
    return {
      settings: { ...this.settings },
      choices: this.choices,
      usesExotic: Hadrons.usesExotic,
      total: Hadrons.hadrons.total,
      current: Hadrons.split,
      // Best result so far per choice, keyed by choice
      results: new Map(),
    };
  },

  startStatus(fields) {
    Object.assign(this.status, {
      running: true, cancelRequested: false, phase: "Preparing", done: 0, total: 0, startedAt: Date.now(),
      error: "", note: "", parallel: false, workers: 0, ...fields,
    });
  },

  // Screens every choice, then runs the leaders again for longer
  async runSearch(context, evaluate) {
    const { settings, choices } = context;
    this.status.total = choices.length + Math.min(settings.confirmCount, choices.length);
    this.status.phase = `Trying ${formatInt(choices.length)} splits`;
    await evaluate(choices, 1);
    if (this.status.cancelRequested || settings.confirmFactor <= 1) return;
    const leaders = this.rank([...context.results.values()]).slice(0, settings.confirmCount);
    this.status.phase = `Confirming the best ${formatInt(leaders.length)}`;
    await evaluate(leaders.map(entry => entry.choice), settings.confirmFactor);
  },

  record(context, entry) {
    const known = context.results.get(entry.choice);
    if (!known || entry.factor >= known.factor) context.results.set(entry.choice, entry);
    this.status.done++;
  },

  // Trials run in Web Workers on copies of the save, so the live game keeps running and is never touched
  async solveParallel() {
    const context = this.solveContext();
    const { settings } = context;
    const original = GameSaveSerializer.serialize(player);
    this.startStatus({ phase: "Starting workers", parallel: true, workers: settings.workers });
    if (!await SolverPool.start(settings.workers)) {
      this.status.running = false;
      await this.solveSingleThread();
      this.status.note = `Solved on the page instead: ${SolverPool.failure}`;
      return;
    }
    try {
      this.status.phase = "Preparing";
      const base = await SolverPool.single({ type: "prepare", kind: "hadron", original, settings });
      const seed = Math.floor(Math.random() * 2 ** 31) + 1;
      await SolverPool.broadcast({ type: "setBase", save: base, seed, settings: {} });
      await this.runSearch(context, (choices, factor) => SolverPool.run(choices, {
        message: choice => ({ type: "trial", kind: "hadron", choice, options: this.trialOptions(settings, factor) }),
        onResult: (choice, result) => this.record(context, { choice, factor, ...result }),
        isCancelled: () => this.status.cancelRequested,
      }));
    } catch (error) {
      // Cancelling stops the workers, which abandons the trials they were running
      if (!this.status.cancelRequested) {
        this.status.error = error.message || String(error);
        // eslint-disable-next-line no-console
        console.error(error);
      }
    } finally {
      SolverPool.release();
      this.finishRun(context);
    }
  },

  // Runs every trial on this page, pausing the live game; used when workers are unavailable or turned off
  async solveSingleThread() {
    const context = this.solveContext();
    const { settings } = context;
    const session = SolverHarness.begin("hadron");
    if (!session) return;
    // Auto Lai'tela keeps its state outside the save, so the trials would otherwise take over the player's run of it
    const autoLaitela = {
      isActive: AutoLaitela.isActive, watching: AutoLaitela.watching, status: AutoLaitela.status, log: AutoLaitela.log
    };
    this.startStatus({});
    SolverHarness.trialSeed = Math.floor(Math.random() * 2 ** 31) + 1;
    try {
      this.prepareBase();
      const base = GameSaveSerializer.serialize(player);
      await this.runSearch(context, async(choices, factor) => {
        for (const choice of choices) {
          if (this.status.cancelRequested) break;
          const result = await this.runTrial(base, choice, this.trialOptions(settings, factor));
          if (result === null) break;
          this.record(context, { choice, factor, ...result });
        }
      });
    } catch (error) {
      this.status.error = error.message || String(error);
      // eslint-disable-next-line no-console
      console.error(error);
    } finally {
      const restoreError = SolverHarness.end(session);
      if (restoreError) this.status.error = restoreError;
      Object.assign(AutoLaitela, autoLaitela);
      this.finishRun(context);
    }
  },

  // Best first by the target metric; ties (such as every split walling at once) fall back to Dark Matter, then
  // Antimatter. Longer, confirmed runs come before screening runs so a lucky short run cannot win.
  rank(entries, target = this.settings.target) {
    const metric = HADRON_SOLVER_METRICS.find(m => m.key === target) ?? HADRON_SOLVER_METRICS[0];
    const tieBreaks = ["darkMatter", "antimatter"].map(key => HADRON_SOLVER_METRICS.find(m => m.key === key));
    return [...entries].sort((a, b) => b.factor - a.factor ||
      compareGlyphSolverMetric(metric, b.values[metric.key], a.values[metric.key]) ||
      tieBreaks.reduce((order, m) => order || compareGlyphSolverMetric(m, b.values[m.key], a.values[m.key]), 0));
  },

  finishRun(context) {
    const { settings, usesExotic, total, current } = context;
    const entries = this.rank([...context.results.values()], settings.target);
    // Frozen so the UI does not make every value reactive
    this.status.lastRun = Object.freeze({
      settings,
      usesExotic,
      total,
      current,
      cancelled: this.status.cancelRequested,
      entries,
      keep: entries.find(entry => entry.choice === HADRON_SOLVER_KEEP) ?? null,
      finishedAt: Date.now(),
    });
    this.status.running = false;
    this.status.phase = "";
  },

  cancel() {
    if (!this.status.running) return;
    this.status.cancelRequested = true;
    if (this.status.parallel) SolverPool.stop();
  },

  // Whether a result can still be applied: the Hadrons must be the ones the solve was run with
  canApply(entry, run = this.status.lastRun) {
    return Boolean(entry && run) && entry.choice !== HADRON_SOLVER_KEEP && !this.unavailableReason &&
      Hadrons.usesExotic === run.usesExotic && Hadrons.hadrons.total === run.total && Hadrons.split === run.current;
  },

  apply(entry) {
    if (!this.canApply(entry)) return false;
    return Hadrons.setSplit(entry.choice);
  },
};
