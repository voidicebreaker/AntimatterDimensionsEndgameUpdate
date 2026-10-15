/* Browser integration checks for running solver trials on Web Workers. */
const assert = require("node:assert/strict");

const { chromium } = require("playwright-core");

(async() => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"]
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(process.env.SOLVER_TEST_URL || "http://127.0.0.1:8080/");
    await page.getByText("Start New Game", { exact: true }).waitFor();
    const checks = await page.evaluate(async() => {
      const results = [];
      const check = (condition, message) => {
        if (!condition) throw new Error(message);
        results.push(message);
      };
      const fixture = () => {
        GameStorage.offlineEnabled = false;
        GameStorage.loadPlayerObject(Player.defaultStart);
        GameIntervals.stop();
        Modal.hideAll();
        Quote.clearAll();
        player.realities = new Decimal(1);
        player.auto.autobuyersOn = false;
        for (const type of BASIC_GLYPH_TYPES) {
          for (let i = 0; i < 3; i++) Glyphs.addToInventory(GlyphGenerator.endgameGlyph(type));
        }
        Currency.antimatter.value = new Decimal(1e10);
        buyMaxDimension(1);
        Object.assign(GlyphSolver.settings, {
          seconds: 5, quickTicks: 2, screenTicks: 4, refineTicks: 8, refineCount: 2, keepFraction: 0.25, keepMin: 5,
          exhaustive: false, target: "antimatter", useTimeFlow: false, workers: 2,
          excluded: ["effarig", "reality", "dilation"],
        });
      };
      const realCreateWorker = SolverPool.createWorker;

      fixture();
      check(SolverPool.isSupported && GlyphSolver.canUseWorkers, "Solver workers are available on this page");
      check(await SolverPool.start(2) && SolverPool.workers.length === 2, "Two workers start and load the game");

      // The same trial gives the same result in a worker and on the page when both use the same seed
      const base = GameSaveSerializer.serialize(player);
      await SolverPool.broadcast({ type: "setBase", save: base, seed: 777, settings: { glyph: { excluded: [] } } });
      const options = { seconds: 5, realSeconds: 5, ticks: 6 };
      const counts = [3, 0, 0, 0, 0, 0, 0];
      const inWorker = reviveSolverValues(await SolverPool.single({ type: "trial", kind: "glyph", choice: counts,
        options }));
      const session = SolverHarness.begin("test");
      SolverHarness.trialSeed = 777;
      const onPage = await GlyphSolver.runTrial(base, counts, options);
      SolverHarness.end(session);
      check(GLYPH_SOLVER_METRICS.filter(m => !m.isTime).every(m => inWorker[m.key].eq(onPage[m.key])),
        "A worker trial matches the same trial run on the page");

      // A parallel solve with successive halving never touches the live save
      fixture();
      const live = GameSaveSerializer.serialize(player);
      await GlyphSolver.solve();
      let run = GlyphSolver.status.lastRun;
      check(!GlyphSolver.status.error, `Parallel solve finished without error ${GlyphSolver.status.error}`);
      check(GlyphSolver.status.parallel && GlyphSolver.status.workers === 2, "The solve ran on two workers");
      check(run.results.length === 20, "Every loadout has a result");
      check(GlyphSolver.status.done === 20 + 5 + 2 && GlyphSolver.status.workDone === GlyphSolver.status.workTotal,
        "Successive halving runs every loadout, then the best five, then the best two");
      check(run.results.slice(0, 2).every(r => r.ticks === 8) && run.results[2].ticks === 4,
        "Results are ordered from the most accurate runs down");
      check(GameSaveSerializer.serialize(player) === live, "The live save is never touched by a parallel solve");
      check(!SolverHarness.isSimulating && GameStorage.canSave(), "The page keeps saving normally while solving");

      // Cancelling stops the workers straight away
      fixture();
      GlyphSolver.settings.excluded = [];
      GlyphSolver.settings.quickTicks = 40;
      const solving = GlyphSolver.solve();
      while (GlyphSolver.status.done < 1) await new Promise(resolve => setTimeout(resolve, 20));
      GlyphSolver.cancel();
      await solving;
      run = GlyphSolver.status.lastRun;
      check(run.cancelled && !GlyphSolver.status.running && !GlyphSolver.status.error,
        "Cancelling ends the solve without an error");
      check(SolverPool.workers.length === 0, "Cancelling terminates the workers");

      // If workers cannot start, the solver falls back to running on the page
      fixture();
      SolverPool.createWorker = () => new Worker("data:text/javascript,throw new Error('no game here')");
      try {
        await GlyphSolver.solve();
      } finally {
        SolverPool.createWorker = realCreateWorker;
      }
      check(!GlyphSolver.status.parallel && GlyphSolver.status.note.startsWith("Solved on the page instead"),
        "A failed worker start falls back to solving on the page, and says so");
      check(GlyphSolver.status.lastRun.results.length === 20, "The fallback solve still produces every result");

      // The EC solver runs its rounds on the workers too
      GameStorage.loadPlayerObject(Player.defaultStart);
      GameIntervals.stop();
      player.hasSeenIntro = true;
      player.break = true;
      Currency.realities.value = new Decimal(20);
      Currency.eternities.value = new Decimal(1e6);
      Currency.eternityPoints.value = new Decimal("1e100");
      Currency.timeTheorems.value = new Decimal(20000);
      NormalChallenges.completeAll();
      player.reality.perks.add(Perk.studyECRequirement.id);
      const ecLive = GameSaveSerializer.serialize(player);
      const realGoal = ECSolver.goal;
      ECSolver.goal = () => new Decimal(1);
      Object.assign(ECSolver.settings, {
        ec: 2, target: 1, seconds: 30, screenTicks: 10, confirmTicks: 20, confirmCount: 2, maxRounds: 2,
        useTimeFlow: false, workers: 2, groups: { tree: false, crunch: true, replicanti: true, limits: false },
      });
      try {
        await ECSolver.solve();
      } finally {
        ECSolver.goal = realGoal;
      }
      const ecRun = ECSolver.status.lastRun;
      check(!ECSolver.status.error && ECSolver.status.parallel, `The EC solve ran on workers ${ECSolver.status.error}`);
      check(ecRun.entries.length > 0 && ecRun.entries.every(e => !e.failed && e.reachedAt !== null),
        "Every EC trial on a worker enters the challenge and reaches the goal");
      check(ecRun.recommended.ticks === 20 && ecRun.recommended.exportString.endsWith("|2"),
        "The EC recommendation comes from a confirmed run with its tree");
      check(GameSaveSerializer.serialize(player) === ecLive, "The live save is never touched by a parallel EC solve");
      SolverPool.stop();
      return results;
    });
    assert.deepEqual(errors, []);
    for (const message of checks) console.log(`ok - ${message}`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
