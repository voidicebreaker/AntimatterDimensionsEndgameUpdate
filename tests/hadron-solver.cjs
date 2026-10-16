/* Browser integration checks for the Hadron split solver. */
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
      const comparable = save => {
        const object = GameSaveSerializer.deserialize(save);
        delete object.lastUpdate;
        delete object.backupTimer;
        // Restoring the save credits the time spent solving as offline progress
        delete object.speedrun.offlineTimeUsed;
        // The news ticker keeps running on the page while workers solve
        delete object.news;
        return JSON.stringify(object);
      };
      // Lists the first few differing paths, so a failed restore check says what changed
      const sameSave = (first, second) => {
        const paths = [];
        const walk = (a, b, path) => {
          if (paths.length >= 10) return;
          if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
            if (JSON.stringify(a) !== JSON.stringify(b)) paths.push(path);
            return;
          }
          for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], `${path}.${key}`);
        };
        walk(JSON.parse(comparable(first)), JSON.parse(comparable(second)), "");
        return { same: paths.length === 0, paths: paths.join(", ") };
      };
      const hadrons = () => player.celestials.laitela.hadrons;
      const split = () => `${hadrons().light}/${hadrons().dark}/${hadrons().exotic}`;
      const fixture = () => {
        AutoLaitela.stop("");
        GameStorage.offlineEnabled = false;
        GameStorage.loadPlayerObject(Player.defaultStart);
        GameIntervals.stop();
        Modal.hideAll();
        Quote.clearAll();
        player.hasSeenIntro = true;
        // Solving on the page takes long enough that restoring would otherwise credit it as offline progress
        player.options.offlineProgress = false;
        player.realities = new Decimal(10);
        player.reality.imaginaryUpgradeBits |= 1 << 15;
        for (const id of [15, 16, 17, 18, 19]) player.reality.dualityUpgradeBits |= 1 << id;
        Object.assign(hadrons(), { total: 5, light: 3, dark: 2, exotic: 0 });
        player.records.thisEndgame.realTime = 1e8;
        // Something for the reset to visibly take away
        player.celestials.laitela.singularities = new Decimal(1e10);
        Currency.darkMatter.value = new Decimal(1e30);
        // Round-trip once so values that do not survive serialization match from here on
        GameStorage.loadPlayerObject(GameSaveSerializer.deserialize(GameSaveSerializer.serialize(player)));
        GameIntervals.stop();
      };

      fixture();
      check(HadronSolver.unavailableReason === "", "The solver is available once Dark Hadrons are");
      check(!Hadrons.usesExotic && Hadrons.split === 3, "Before Divinity 3 the split is the Light Hadron count");
      check(JSON.stringify(HadronSolver.choices) === JSON.stringify(["keep", 0, 1, 2, 4, 5]),
        "Every other split is a choice, and the current one is the no-reset baseline");
      player.records.thisReality.realTime = 5e6;
      check(Hadrons.setSplit(5) && split() === "5/0/0", "setSplit moves straight to the target split");
      check(Currency.singularities.value.lte(10) && Currency.darkMatter.value.lt(1e30),
        "Switching resets Singularities and Dark Matter");
      check(player.records.thisReality.realTime < 5e6, "Switching before Divinity 3 restarts the Reality");
      check(!Hadrons.setSplit(5) && !Hadrons.setSplit(9) && split() === "5/0/0",
        "Asking for the current split, or past the end, does nothing");
      check(Hadrons.setSplit(-3) && split() === "0/5/0", "Targets are clamped to the Hadrons owned");

      fixture();
      Currency.divinities.value = 3;
      Object.assign(hadrons(), { light: 5, dark: 5 });
      check(Hadrons.usesExotic && Hadrons.split === 0, "After Divinity 3 the split is the Exotic Hadron count");
      check(Hadrons.setSplit(2) && split() === "3/3/2", "Exotic Hadrons take one Light and one Dark Hadron each");
      check(player.records.thisEndgame.realTime < 1e8, "Switching after Divinity 3 restarts the Endgame");
      check(Hadrons.describeSplit(2).includes("Exotic"), "Splits are described in Exotic terms after Divinity 3");

      // A real trial: rebuild, then Auto Lai'tela, which walls at once on a fresh save and stops the trial early
      fixture();
      const base = GameSaveSerializer.serialize(player);
      SolverHarness.isSimulating = true;
      const options = { rebuildSeconds: 10, rebuildTicks: 10, laitelaSeconds: 120, laitelaTicks: 600 };
      let first;
      let second;
      let keep;
      try {
        first = await HadronSolver.runTrial(base, 5, options);
        second = await HadronSolver.runTrial(base, 5, options);
        keep = await HadronSolver.runTrial(base, "keep", options);
        check(hadrons().light === 3, "The baseline trial keeps the current split");
      } finally {
        SolverHarness.isSimulating = false;
      }
      check(first.values.singularities.lte(10) && keep.values.singularities.gte(1e10),
        "Only switching trials pay the reset");
      check(keep.recoveredAt.singularities === 0 && first.recoveredAt.singularities === null,
        "Trials record when each lost resource gets back to its amount before switching");
      check(first.laitelaOutcome === "walled" && first.laitelaTime < 60,
        "A split that walls stops the trial as soon as Auto Lai'tela gives up");
      check(first.antimatterNeeded.gt(first.antimatterReached), "A walled trial reports how far it is from the wall");
      check(Object.keys(first.values).every(key => first.values[key].eq(second.values[key])),
        "Trials of the same split are deterministic");
      check(HADRON_SOLVER_METRICS.every(metric => first.values[metric.key] instanceof Decimal),
        "Every metric is recorded");
      check(!AutoLaitela.isActive && !AutoLaitela.allowInSimulation, "Trials leave Auto Lai'tela off afterwards");

      // A whole solve on the page itself
      fixture();
      const before = GameSaveSerializer.serialize(player);
      Object.assign(HadronSolver.settings, {
        rebuildSeconds: 5, rebuildTicks: 5, laitelaSeconds: 40, confirmFactor: 2, confirmCount: 2,
        freshEndgame: false, useTimeFlow: false, workers: 0, target: "laitelaProgress",
      });
      AutoLaitela.status = "Player status";
      await HadronSolver.solve();
      let run = HadronSolver.status.lastRun;
      check(!HadronSolver.status.error, `The solve finished without error ${HadronSolver.status.error}`);
      check(run.entries.length === 6 && new Set(run.entries.map(e => e.choice)).size === 6,
        "Every split is reported once");
      check(run.entries.filter(e => e.factor === 2).length === 2 && run.entries[0].factor === 2,
        "The best splits are confirmed with longer runs and ranked first");
      check(run.keep && run.keep.choice === "keep", "The no-reset baseline is reported for comparison");
      const restored = sameSave(before, GameSaveSerializer.serialize(player));
      check(restored.same, `The save is restored exactly after solving ${restored.paths}`);
      check(AutoLaitela.status === "Player status" && !AutoLaitela.isActive,
        "Auto Lai'tela's own state is put back after solving on the page");
      check(!SolverHarness.isSimulating && GameStorage.canSave(), "Saving is allowed again after solving");

      const ranked = HadronSolver.rank(run.entries, "singularities");
      check(ranked[0].values.singularities.gte(ranked[ranked.length - 1].values.singularities),
        "Results can be re-ranked by any metric");
      const best = run.entries.find(e => e.choice !== "keep");
      check(HadronSolver.canApply(best) && HadronSolver.apply(best) && Hadrons.split === best.choice,
        "Apply switches the live save to the chosen split");
      check(!HadronSolver.canApply(best), "A result cannot be applied again once the Hadrons have changed");

      // The same search in Web Workers
      fixture();
      const beforeParallel = GameSaveSerializer.serialize(player);
      HadronSolver.settings.workers = 2;
      await HadronSolver.solve();
      run = HadronSolver.status.lastRun;
      check(!HadronSolver.status.error && !HadronSolver.status.note,
        `The solve runs in workers ${HadronSolver.status.error}${HadronSolver.status.note}`);
      check(run.entries.length === 6 && run.entries.every(e => e.values.antimatter instanceof Decimal),
        "Worker results come back with every value as a Decimal");
      const untouched = sameSave(beforeParallel, GameSaveSerializer.serialize(player));
      check(untouched.same, `A worker solve never touches the live save ${untouched.paths}`);
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
