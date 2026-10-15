// Advises on how to complete an Eternity Challenge by trying strategies on throwaway copies of the save. A strategy is
// one choice per lever (study tree paths plus a few autobuyer settings). Each trial starts from a fresh Eternity,
// buys the tree, enters the EC and lets the autobuyers play until the goal is reached or the time runs out. The search
// is coordinate descent: change one lever at a time, keep any improvement, and repeat until nothing improves.
// Nothing found here is ever applied to the real save; the player follows the advice themselves.
import { SolverPool } from "./solver-pool";

const SPLIT_PAIRS = [[221, 222], [223, 224], [225, 226], [227, 228], [231, 232], [233, 234]];
// Built on first use, since the game's constants are not guaranteed to exist while modules are still loading
const dimensionPaths = () => [TIME_STUDY_PATH.ANTIMATTER_DIM, TIME_STUDY_PATH.INFINITY_DIM, TIME_STUDY_PATH.TIME_DIM];
const pacePaths = () => [TIME_STUDY_PATH.ACTIVE, TIME_STUDY_PATH.PASSIVE, TIME_STUDY_PATH.IDLE];

const option = (label, value) => ({ label, value });

// Every lever lists its options; the first option is the default unless the EC's usual route says otherwise
const buildLevers = () => {
  const PATH_NAMES = {
    [TIME_STUDY_PATH.ANTIMATTER_DIM]: "Antimatter",
    [TIME_STUDY_PATH.INFINITY_DIM]: "Infinity",
    [TIME_STUDY_PATH.TIME_DIM]: "Time",
    [TIME_STUDY_PATH.ACTIVE]: "Active",
    [TIME_STUDY_PATH.PASSIVE]: "Passive",
    [TIME_STUDY_PATH.IDLE]: "Idle",
  };
  return [
    {
      key: "dimension",
      name: "Dimension path",
      group: "tree",
      // Later paths in a combination are bought last, after the studies which allow extra paths
      options: [
        [TIME_STUDY_PATH.ANTIMATTER_DIM], [TIME_STUDY_PATH.INFINITY_DIM], [TIME_STUDY_PATH.TIME_DIM],
        [TIME_STUDY_PATH.ANTIMATTER_DIM, TIME_STUDY_PATH.INFINITY_DIM],
        [TIME_STUDY_PATH.ANTIMATTER_DIM, TIME_STUDY_PATH.TIME_DIM],
        [TIME_STUDY_PATH.INFINITY_DIM, TIME_STUDY_PATH.TIME_DIM],
        dimensionPaths(),
      ].map(paths => option(paths.map(p => PATH_NAMES[p]).join(" + "), paths)),
    },
    {
      key: "pace",
      name: "Pace path",
      group: "tree",
      options: pacePaths().map(p => option(PATH_NAMES[p], p)),
    },
    ...SPLIT_PAIRS.map(([light, dark]) => ({
      key: `split${light}`,
      name: `Study ${light} / ${dark}`,
      group: "tree",
      options: [option(`${light}`, light), option(`${dark}`, dark)],
    })),
    {
      key: "crunch",
      name: "Big Crunch autobuyer",
      group: "crunch",
      // Timer modes are left out: a trial can crunch at most once per tick, so it cannot represent crunching every
      // fraction of a second the way live play does
      options: [
        option("×2 highest IP", { mode: AUTO_CRUNCH_MODE.X_HIGHEST, xHighest: 2 }),
        option("×1e10 highest IP", { mode: AUTO_CRUNCH_MODE.X_HIGHEST, xHighest: 1e10 }),
        option("×1e100 highest IP", { mode: AUTO_CRUNCH_MODE.X_HIGHEST, xHighest: 1e100 }),
        option("×1e1000 highest IP", { mode: AUTO_CRUNCH_MODE.X_HIGHEST, xHighest: "1e1000" }),
        option("Off", { off: true }),
      ],
    },
    {
      key: "replicantiGalaxies",
      name: "Replicanti Galaxy autobuyer",
      group: "replicanti",
      options: [option("On", true), option("Off", false)],
    },
    {
      key: "limits",
      name: "Boosts and Galaxies",
      group: "limits",
      options: [
        option("Both unlimited", "unlimited"),
        option("No Antimatter Galaxies", "noGalaxies"),
        option("No Dimension Boosts", "noBoosts"),
      ],
    },
  ];
};

let leverCache = null;
export const ecSolverLevers = () => (leverCache ??= buildLevers());
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));

// Positive when a is the better trial: reaching the goal beats everything, then sooner, then more IP
export function compareECSolverResults(a, b) {
  if (a.failed !== b.failed) return a.failed ? -1 : 1;
  if (a.reachedAt !== null || b.reachedAt !== null) {
    if (a.reachedAt === null) return -1;
    if (b.reachedAt === null) return 1;
    return b.reachedAt - a.reachedAt;
  }
  return a.finalLog - b.finalLog;
}

export const ECSolver = {
  settings: {
    ec: 0,
    target: 5,
    seconds: 600,
    // Measured on an Alpha EC11 run: results settle by about 300 ticks and match 3000+ ticks from 1000
    screenTicks: 300,
    confirmTicks: 1000,
    confirmCount: 3,
    maxRounds: 4,
    useTimeFlow: true,
    // Web Workers to run trials on; 0 runs them on the page itself, pausing the game
    workers: SolverPool.defaultSize,
    groups: { tree: true, crunch: true, replicanti: true, limits: true },
  },
  status: {
    running: false,
    cancelRequested: false,
    phase: "",
    done: 0,
    round: 0,
    startedAt: 0,
    error: "",
    note: "",
    parallel: false,
    workers: 0,
    lastRun: null,
  },

  // The EC that Alpha's current stage asks for, if any
  get alphaChallenge() {
    if (!Alpha.isRunning) return null;
    if (Alpha.currentStage === 19) return { id: 10, target: 1 };
    if (Alpha.currentStage === 22) return { id: 11, target: 5 };
    return null;
  },

  get defaultChallenge() {
    const alpha = this.alphaChallenge;
    if (alpha && EternityChallenge(alpha.id).completions < alpha.target) return alpha;
    const id = EternityChallenges.all.find(ec => ec.completions < 5)?.id ?? 1;
    return { id, target: 5 };
  },

  get challengeId() {
    return this.settings.ec || this.defaultChallenge.id;
  },

  get canBulk() {
    return Perk.studyECBulk.isBought;
  },

  // Alpha stage 22 pins EC11's goal to its fifth tier, which then awards every tier at once
  get isAlphaForcedBulk() {
    return this.challengeId === 11 && Alpha.isRunning && Alpha.currentStage >= 22;
  },

  // The IP needed in one run to reach the target, or the next completion if completions cannot be bulked
  goal(id = this.challengeId, target = this.settings.target) {
    const ec = EternityChallenge(id);
    if (id === 11 && Alpha.isRunning && Alpha.currentStage >= 22) return ec.currentGoal;
    if (this.canBulk) return ec.goalAtCompletions(Math.clamp(target, ec.completions + 1, 5) - 1);
    return ec.goalAtCompletions(ec.completions);
  },

  get unavailableReason() {
    if (GameEnd.creditsEverClosed) return "The game has ended.";
    if (Alpha.isRunning && Alpha.currentStage < 11) return "Eternity is not available yet in this Alpha run.";
    const ec = EternityChallenge(this.challengeId);
    if (!ec) return "Choose an Eternity Challenge.";
    if (ec.completions >= 5 || ec.completions >= this.settings.target) {
      return `Eternity Challenge ${ec.id} is already at ${formatInt(ec.completions)} completions.`;
    }
    if (!Autobuyer.bigCrunch.isUnlocked) return "The Big Crunch autobuyer is needed to run trials.";
    if (!player.auto.autobuyersOn) return "Turn on the autobuyer master switch first.";
    return "";
  },

  // The usual study route for this EC, mapped onto lever choices, is where the search starts
  defaultPlan(id = this.challengeId) {
    const route = new Set(new TimeStudyTree(ECScheduler.route(id)).selectedStudies.map(s => s.id));
    const onRoute = studies => studies.some(s => route.has(s));
    const matchesRoute = (lever, choice) => {
      if (lever.key === "dimension") {
        return choice.value.length === 1 && onRoute(NormalTimeStudies.paths[choice.value[0]]);
      }
      if (lever.key === "pace") return onRoute(NormalTimeStudies.paths[choice.value]);
      return lever.group === "tree" && route.has(choice.value);
    };
    const plan = {};
    for (const lever of ecSolverLevers()) {
      const index = lever.options.findIndex(choice => matchesRoute(lever, choice));
      plan[lever.key] = lever.options[Math.max(index, 0)].value;
    }
    return plan;
  },

  // Every study the plan allows, in an order which buys the paths' unlocks before any second path
  studyOrder(plan, id = this.challengeId) {
    const ecStudy = TimeStudy.eternityChallenge(id);
    const forbidden = Perk.studyECRequirement.isBought ? [] : (ecStudy.config.secondary.forbiddenStudies ?? []);
    const [firstPath, ...laterPaths] = plan.dimension;
    const excluded = new Set([
      ...forbidden,
      ...dimensionPaths().filter(p => p !== firstPath).flatMap(p => NormalTimeStudies.paths[p]),
      ...pacePaths().filter(p => p !== plan.pace).flatMap(p => NormalTimeStudies.paths[p]),
      ...SPLIT_PAIRS.map(([light, dark]) => (plan[`split${light}`] === light ? dark : light)),
    ]);
    const ids = NormalTimeStudyState.all.map(s => s.id).filter(s => !excluded.has(s)).sort((a, b) => a - b);
    for (const path of laterPaths) ids.push(...NormalTimeStudies.paths[path].filter(s => !forbidden.includes(s)));
    return ids;
  },

  // Returns the studies the plan would actually buy from the current state, or a reason it cannot reach the EC
  tree(plan, id = this.challengeId) {
    const tree = new TimeStudyTree(this.studyOrder(plan, id).map(s => TimeStudy(s)));
    const studies = tree.purchasedStudies.filter(s => s instanceof NormalTimeStudyState);
    const ecStudy = TimeStudy.eternityChallenge(id);
    const reachesEC = ecStudy.config.requirement.some(r => studies.some(s => s.id === r));
    return {
      studies,
      reason: reachesEC ? "" : `This tree cannot reach the Eternity Challenge ${id} study.`,
      exportString: `${studies.map(s => s.id).join(",")}|${id}`,
    };
  },

  planKey(plan, tree) {
    const autobuyers = ecSolverLevers().filter(l => l.group !== "tree").map(l => JSON.stringify(plan[l.key]));
    return `${tree.studies.map(s => s.id).join(",")}#${autobuyers.join("#")}`;
  },

  // Autobuyer levers the search did not vary keep the player's own settings, so they are labelled as such; the tree
  // is always bought, falling back to the EC's usual route when its paths are not varied
  describePlan(plan, groups = this.settings.groups) {
    return ecSolverLevers().map(lever => ({
      key: lever.key,
      name: lever.name,
      group: lever.group,
      label: groups[lever.group] || lever.group === "tree"
        ? lever.options.find(o => sameValue(o.value, plan[lever.key]))?.label ?? "?"
        : "Your current setting",
    }));
  },

  applyAutobuyers(plan, groups) {
    const auto = player.auto;
    auto.autobuyersOn = true;
    auto.eternity.isActive = false;
    for (const group of ["antimatterDims", "infinityDims", "timeDims", "replicantiUpgrades"]) {
      if (!auto[group]) continue;
      auto[group].isActive = true;
      for (const buyer of auto[group].all) buyer.isActive = true;
    }
    auto.tickspeed.isActive = true;
    auto.ipMultBuyer.isActive = true;
    auto.epMultBuyer.isActive = true;

    if (groups.crunch) {
      const crunch = plan.crunch;
      auto.bigCrunch.isActive = !crunch.off;
      auto.bigCrunch.increaseWithMult = false;
      if (!crunch.off) {
        auto.bigCrunch.mode = crunch.mode;
        if (crunch.xHighest !== undefined) auto.bigCrunch.xHighest = new Decimal(crunch.xHighest);
        if (crunch.time !== undefined) auto.bigCrunch.time = crunch.time;
      }
    }
    if (groups.replicanti) auto.replicantiGalaxies.isActive = plan.replicantiGalaxies;
    if (groups.limits) {
      auto.dimBoost.isActive = plan.limits !== "noBoosts";
      auto.dimBoost.limitDimBoosts = false;
      auto.dimBoost.limitUntilGalaxies = false;
      auto.galaxy.isActive = plan.limits !== "noGalaxies";
      auto.galaxy.limitGalaxies = false;
    }
  },

  // Leaves any EC and refunds all studies with a reset Eternity, so every trial starts from the same fresh Eternity
  prepareBase() {
    if (EternityChallenge.isRunning) EternityChallenge.current.exit(false);
    if (player.timestudy.studies.length > 0 || player.challenge.eternity.unlocked !== 0) {
      player.respec = true;
      eternity(true);
    }
    if (player.timestudy.studies.length > 0 || player.challenge.eternity.unlocked !== 0) {
      throw new Error("Could not refund your Time Studies to start from a fresh Eternity.");
    }
  },

  async runTrial(base, plan, { id, goalLog, seconds, realSeconds, ticks, groups }) {
    SolverHarness.restoreTrial(base);
    if (player.reality.automator.state.mode !== AUTOMATOR_MODE.STOP) AutomatorBackend.stop();
    player.ecScheduler.running = false;
    const tree = this.tree(plan, id);
    const result = { failed: false, reason: "", reachedAt: null, finalLog: 0, samples: [], ticks };
    if (tree.reason) return { ...result, failed: true, reason: tree.reason };

    TimeStudyTree.commitToGameState(tree.studies);
    const ecStudy = TimeStudy.eternityChallenge(id);
    if (!ecStudy.isBought && !ecStudy.purchase(true)) {
      return { ...result, failed: true, reason: "The EC study could not be bought after this tree." };
    }
    if (!EternityChallenge(id).start(true) || !EternityChallenge(id).isRunning) {
      return { ...result, failed: true, reason: "The Eternity Challenge could not be entered." };
    }
    this.applyAutobuyers(plan, groups);

    const maxIPLog = () => player.records.thisEternity.maxIP.max(1).log10().toNumber();
    let elapsed = 0;
    EventHub.logic.on(GAME_EVENT.CHALLENGE_FAILED, () => {
      result.failed = true;
      result.reason = "The challenge failed its restriction.";
    }, this);
    try {
      const outcome = await SolverHarness.runTicks({
        seconds,
        ticks,
        onStep: fraction => {
          elapsed = realSeconds * fraction;
          const log = maxIPLog();
          result.samples.push([elapsed, log]);
          if (log >= goalLog) {
            result.reachedAt = elapsed;
            return true;
          }
          if (result.failed) return true;
          if (!EternityChallenge(id).isRunning) {
            result.failed = true;
            result.reason = "Something left the challenge (check other Eternity autobuyers).";
            return true;
          }
          return false;
        },
        isCancelled: () => this.status.cancelRequested,
      });
      if (outcome === "cancelled") return null;
    } finally {
      EventHub.logic.offAll(this);
    }
    result.finalLog = maxIPLog();
    result.eta = this.estimateRemaining(result.samples, goalLog);
    return result;
  },

  // Seconds still needed at the growth rate of the last third of the run; a rough guide, as growth often speeds up
  estimateRemaining(samples, goalLog) {
    if (samples.length < 3) return null;
    const [endTime, endLog] = samples[samples.length - 1];
    if (endLog >= goalLog) return 0;
    const [startTime, startLog] = samples[Math.floor(samples.length * 2 / 3)];
    const rate = (endLog - startLog) / Math.max(endTime - startTime, 1e-9);
    return rate > 0 ? (goalLog - endLog) / rate : null;
  },

  get canUseWorkers() {
    return SolverPool.isSupported && this.settings.workers > 0;
  },

  async solve() {
    if (this.status.running || SolverHarness.isBusy || this.unavailableReason) return;
    if (this.canUseWorkers) await this.solveParallel();
    else await this.solveSingleThread();
  },

  // Everything a solve needs that does not depend on where its trials run
  solveContext() {
    const id = this.challengeId;
    const settings = { ...this.settings, ec: id, groups: { ...this.settings.groups } };
    const goalLog = this.goal(id, settings.target).log10().toNumber();
    const seconds = settings.seconds * (settings.useTimeFlow ? Overclock.timeFlow : 1);
    return {
      id,
      settings,
      goalLog,
      seconds,
      levers: ecSolverLevers().filter(l => settings.groups[l.group]),
      cache: new Map(),
      trialOptions: ticks => ({
        id, goalLog, seconds, realSeconds: settings.seconds, ticks, groups: settings.groups
      }),
    };
  },

  startStatus(fields) {
    Object.assign(this.status, {
      running: true, cancelRequested: false, phase: "Preparing", done: 0, round: 0, startedAt: Date.now(),
      error: "", note: "", parallel: false, workers: 0, ...fields,
    });
  },

  // Trials run in Web Workers on copies of the save, so the live game keeps running and is never touched
  async solveParallel() {
    const context = this.solveContext();
    const { id, settings, cache, trialOptions } = context;
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
      const base = await SolverPool.single({ type: "prepare", kind: "ec", original, settings: {} });
      const seed = Math.floor(Math.random() * 2 ** 31) + 1;
      await SolverPool.broadcast({ type: "setBase", save: base, seed, settings: {} });

      // Trees are worked out by a worker on the fresh-Eternity state, so plans buying the same tree run only once
      const evaluateBatch = async(plans, ticks) => {
        const trees = await SolverPool.single({ type: "trees", plans, ec: id });
        const jobs = new Map();
        plans.forEach((plan, i) => {
          const key = `${trees[i].key}@${ticks}`;
          if (!cache.has(key) && !jobs.has(key)) {
            jobs.set(key, { plan, key, planKey: trees[i].key, exportString: trees[i].exportString });
          }
        });
        await SolverPool.run([...jobs.values()], {
          message: job => ({ type: "trial", kind: "ec", choice: job.plan, options: trialOptions(ticks) }),
          onResult: (job, result) => {
            cache.set(job.key, { ...job, result });
            this.status.done++;
          },
          isCancelled: () => this.status.cancelRequested,
        });
        return plans.map((plan, i) => cache.get(`${trees[i].key}@${ticks}`)).filter(Boolean);
      };
      await this.runSearch(context, evaluateBatch);
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
    const { id, cache, trialOptions } = context;
    const session = SolverHarness.begin("ec");
    if (!session) return;
    this.startStatus({});
    SolverHarness.trialSeed = Math.floor(Math.random() * 2 ** 31) + 1;
    try {
      this.prepareBase();
      const base = GameSaveSerializer.serialize(player);
      // Trees are worked out on the fresh-Eternity state, so the cache key matches what each trial will buy
      const evaluateBatch = async(plans, ticks) => {
        const entries = [];
        for (const plan of plans) {
          if (this.status.cancelRequested) break;
          const tree = this.tree(plan, id);
          const planKey = this.planKey(plan, tree);
          const key = `${planKey}@${ticks}`;
          if (!cache.has(key)) {
            const result = await this.runTrial(base, plan, trialOptions(ticks));
            SolverHarness.restoreTrial(base);
            if (result === null) break;
            cache.set(key, { plan, key, planKey, exportString: tree.exportString, result });
            this.status.done++;
          }
          entries.push(cache.get(key));
        }
        return entries;
      };
      await this.runSearch(context, evaluateBatch);
    } catch (error) {
      this.status.error = error.message || String(error);
      // eslint-disable-next-line no-console
      console.error(error);
    } finally {
      const restoreError = SolverHarness.end(session);
      if (restoreError) this.status.error = restoreError;
      this.finishRun(context);
    }
  },

  async runSearch({ id, settings, levers, cache }, evaluateBatch) {
    this.status.phase = "Searching";
    await this.search({
      evaluateBatch: plans => evaluateBatch(plans, settings.screenTicks),
      startPlan: this.defaultPlan(id),
      levers,
      maxRounds: settings.maxRounds,
    });
    if (!this.status.cancelRequested && settings.confirmTicks > settings.screenTicks) {
      this.status.phase = "Confirming";
      const top = this.rankEntries([...cache.values()]).filter(e => !e.result.failed).slice(0, settings.confirmCount);
      await evaluateBatch(top.map(e => e.plan), settings.confirmTicks);
    }
  },

  finishRun({ settings, seconds, goalLog, cache }) {
    // Only the most accurate run of each plan is reported, so quick screening results never outrank confirmed ones
    const byPlan = new Map();
    for (const entry of cache.values()) {
      const known = byPlan.get(entry.planKey);
      if (!known || entry.result.ticks > known.result.ticks) byPlan.set(entry.planKey, entry);
    }
    const entries = this.rankEntries([...byPlan.values()]);
    const confirmed = entries.filter(e => e.result.ticks === settings.confirmTicks);
    const recommended = confirmed[0] ?? entries[0] ?? null;
    // Frozen so the UI does not make every sample reactive
    this.status.lastRun = Object.freeze({
      settings,
      seconds,
      goalLog,
      isAlphaForcedBulk: this.isAlphaForcedBulk,
      cancelled: this.status.cancelRequested,
      recommended: recommended && this.summarize(recommended, settings.groups),
      entries: entries.map(e => this.summarize(e, settings.groups)),
      finishedAt: Date.now(),
    });
    this.status.running = false;
    this.status.phase = "";
  },

  // Coordinate descent in rounds: every single-lever change of the best plan so far is tried at once (in parallel
  // when workers are available). The best change wins, unless combining every lever's improving change does better.
  async search({ evaluateBatch, startPlan, levers, maxRounds }) {
    let [best] = await evaluateBatch([startPlan]);
    for (let round = 1; best && round <= maxRounds && !this.status.cancelRequested; round++) {
      this.status.round = round;
      const current = best;
      const changes = levers.flatMap(lever => lever.options
        .filter(choice => !sameValue(choice.value, current.plan[lever.key]))
        .map(choice => ({ lever, plan: { ...current.plan, [lever.key]: choice.value } })));
      const entries = await evaluateBatch(changes.map(c => c.plan));
      const improving = new Map();
      for (const entry of entries) {
        if (compareECSolverResults(entry.result, current.result) <= 0) continue;
        const lever = levers.find(l => !sameValue(entry.plan[l.key], current.plan[l.key]));
        const known = improving.get(lever.key);
        if (!known || compareECSolverResults(entry.result, known.result) > 0) improving.set(lever.key, entry);
      }
      if (improving.size === 0) break;
      const candidates = [...improving.values()];
      if (improving.size > 1) {
        const combined = { ...current.plan };
        for (const [key, entry] of improving) combined[key] = entry.plan[key];
        candidates.push(...await evaluateBatch([combined]));
      }
      best = candidates.reduce((a, b) => (compareECSolverResults(b.result, a.result) > 0 ? b : a));
      await yieldFrame();
    }
    return best;
  },

  rankEntries(entries) {
    // Results at more ticks are more accurate, so they win ties between the same plan
    return [...entries].sort((a, b) => compareECSolverResults(b.result, a.result) || b.result.ticks - a.result.ticks);
  },

  summarize(entry, groups) {
    const { result } = entry;
    return {
      key: entry.key,
      choices: this.describePlan(entry.plan, groups),
      exportString: entry.exportString,
      failed: result.failed,
      reason: result.reason,
      reachedAt: result.reachedAt,
      finalLog: result.finalLog,
      eta: result.eta ?? null,
      ticks: result.ticks,
    };
  },

  cancel() {
    if (!this.status.running) return;
    this.status.cancelRequested = true;
    if (this.status.parallel) SolverPool.stop();
  },
};
