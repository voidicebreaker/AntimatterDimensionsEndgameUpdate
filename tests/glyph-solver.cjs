/* Browser integration checks for the Glyph loadout solver. */
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
      Glyphs.addToInventory(GlyphGenerator.endgameGlyph("effarig"));
      Glyphs.addToInventory(GlyphGenerator.endgameGlyph("effarig"));
      Glyphs.addToInventory(GlyphGenerator.realityGlyph(new Decimal(100)));
      Glyphs.addToInventory(GlyphGenerator.realityGlyph(new Decimal(100)));
      Currency.antimatter.value = new Decimal(1e10);
      buyMaxDimension(1);

      check(GlyphSolver.freeSlotCount === 3, "A fresh save with Reality has three free slots");
      check(GlyphSolver.unavailableReason === "", "The solver is available with glyphs in the inventory");
      let pool = GlyphSolver.pool;
      check(pool.filter(p => BASIC_GLYPH_TYPES.includes(p.type)).every(p => p.cap === 3),
        "Basic types may fill every slot");
      check(pool.find(p => p.type === "effarig").cap === 1 && pool.find(p => p.type === "reality").cap === 1,
        "Effarig and Reality are limited to one each without Achievement 196");
      check(GlyphSolver.loadoutCount === 70, "70 loadouts fill three slots with single special glyphs");
      Achievement(196).unlock();
      pool = GlyphSolver.pool;
      check(pool.find(p => p.type === "effarig").cap === 2 && pool.find(p => p.type === "reality").cap === 2,
        "Achievement 196 allows two Effarig and two Reality glyphs");
      check(GlyphSolver.loadoutCount === 82, "82 loadouts fill three slots with two special glyphs allowed");
      check(pool.every(p => p.isUniform), "Identical endgame glyphs are reported as a uniform pool");
      for (const glyph of player.reality.glyphs.inventory.filter(g => g.type === "effarig")) {
        Glyphs.removeFromInventory(glyph);
      }
      const effarig = GlyphSolver.pool.find(p => p.type === "effarig");
      check(effarig.cap === 2 && effarig.synthesized === 2 && effarig.owned === 0,
        "Missing Effarig glyphs are stood in for by the best ones the player could make");
      check(GlyphSolver.loadoutCount === 82, "Stand-in glyphs keep every loadout available");
      GlyphSolver.settings.excluded = ["effarig", "reality", "dilation"];
      check(GlyphSolver.loadoutCount === 20, "Excluding types removes them from the search");
      check(GlyphSolver.loadouts().every(c => c.reduce((a, b) => a + b, 0) === 3),
        "Every loadout fills all free slots");

      // Unused dimension costs of Infinity reload as 0 on any save/load; round-trip once so only the solver is compared
      GameStorage.loadPlayerObject(GameSaveSerializer.deserialize(GameSaveSerializer.serialize(player)));
      GameIntervals.stop();
      const before = GameSaveSerializer.serialize(player);
      // These checks cover the single-thread path; tests/solver-pool.cjs covers workers and successive halving
      Object.assign(GlyphSolver.settings, { seconds: 5, screenTicks: 4, refineTicks: 8, refineCount: 2,
        target: "antimatter", useTimeFlow: false, workers: 0, exhaustive: true });
      await GlyphSolver.solve();
      const run = GlyphSolver.status.lastRun;
      check(!GlyphSolver.status.error, `Solve finished without error ${GlyphSolver.status.error}`);
      check(run.results.length === 20, "Every loadout produced a result");
      check(run.results.slice(0, 2).every(r => r.ticks === 8), "The top results were re-run at refine accuracy");
      const restored = sameSave(before, GameSaveSerializer.serialize(player));
      check(restored.same, `The save is restored exactly after solving ${restored.paths}`);
      check(!SolverHarness.isSimulating && GameStorage.canSave(), "Saving is allowed again after solving");
      const top = run.results[0];
      const replication = run.results.find(r => r.name === "RRR");
      check(Decimal.gt(top.values.antimatter, replication.values.antimatter),
        `The best antimatter loadout (${top.name}) beats Replication-only glyphs`);

      check(GlyphSolver.apply(top.counts), "Applying a loadout succeeds");
      check(player.reality.glyphs.active.length === 3, "Applying equips every slot");
      const equipped = GlyphSolver.describe(GlyphSolver.pool.map(p =>
        player.reality.glyphs.active.filter(g => g.type === p.type).length));
      check(equipped === top.name, "Applying equips exactly the chosen types");

      check(GlyphSolver.needsRestart, "Equipped glyphs make the next solve start from a restarted Reality");
      const equippedSave = GameSaveSerializer.serialize(player);
      await GlyphSolver.solve();
      check(!GlyphSolver.status.error, `Restarted solve finished without error ${GlyphSolver.status.error}`);
      const restoredEquipped = sameSave(equippedSave, GameSaveSerializer.serialize(player));
      check(restoredEquipped.same, `The equipped save is restored after a restarted solve ${restoredEquipped.paths}`);

      // Ranking by Lai'tela: further is better, and among equally far loadouts the faster one wins
      const fake = (name, progress, time) => ({ name, ticks: 1,
        values: { laitelaProgress: new Decimal(progress), laitelaTime: time } });
      const laitelaOrder = rankGlyphSolverResults([fake("slow", 3, 50), fake("short", 2.5, 1), fake("fast", 3, 20),
        fake("none", 0.1, null)], "laitelaProgress").map(r => r.name).join(",");
      check(laitelaOrder === "fast,slow,short,none", `Lai'tela ranking uses time as its tie-break (${laitelaOrder})`);

      Object.assign(GlyphSolver.settings, { laitela: true, target: "laitelaProgress" });
      const lockedSettings = GlyphSolver.solveSettings();
      check(!GlyphSolver.canMeasureLaitela && lockedSettings.laitela === false,
        "Lai'tela is never measured before it is unlocked, even with the option on");
      check(lockedSettings.target === "antimatter",
        "A Lai'tela target falls back to Antimatter when Lai'tela cannot be measured");
      player.reality.imaginaryUpgradeBits |= 1 << 15;
      check(GlyphSolver.canMeasureLaitela, "Lai'tela can be measured once it is unlocked");
      // A real trial on this fresh save: Auto Lai'tela walls in its first run, which the trial reports and stops at
      Object.assign(GlyphSolver.settings, { laitela: true, laitelaSeconds: 60, useTimeFlow: false });
      const laitelaOptions = GlyphSolver.laitelaOptions(GlyphSolver.solveSettings());
      check(laitelaOptions.ticks === 20 && laitelaOptions.seconds === 60,
        "The Lai'tela phase is simulated at ten ticks per 30 seconds");
      check(GlyphSolver.restartWithoutGlyphs(), "Glyphs equipped by earlier checks are unequipped for the trial");
      const laitelaBase = GameSaveSerializer.serialize(player);
      SolverHarness.isSimulating = true;
      let trials;
      try {
        const options = { seconds: 5, realSeconds: 5, ticks: 4, laitela: laitelaOptions };
        const counts = GlyphSolver.loadouts()[0];
        trials = [await GlyphSolver.runTrial(laitelaBase, counts, options),
          await GlyphSolver.runTrial(laitelaBase, counts, options)];
      } finally {
        SolverHarness.isSimulating = false;
      }
      const [trial, repeat] = trials;
      check(trial.laitela.outcome === "walled" && trial.laitela.dimensionsLeft === 8,
        "A loadout that cannot destabilize is reported as walling at 8 Dimensions");
      check(trial.laitelaProgress instanceof Decimal && trial.laitelaProgress.lt(1) && trial.laitelaTime === null,
        "Walling at once scores only the entropy of that run, with no Lai'tela time");
      check(trial.laitelaProgress.eq(repeat.laitelaProgress) && trial.antimatter.eq(repeat.antimatter),
        "Lai'tela trials of the same loadout are deterministic");
      check(!AutoLaitela.isActive && !AutoLaitela.allowInSimulation, "Trials leave Auto Lai'tela off afterwards");

      // A whole solve measuring Lai'tela on the page, which must put Auto Lai'tela's own state back
      GameStorage.loadPlayerObject(GameSaveSerializer.deserialize(GameSaveSerializer.serialize(player)));
      GameIntervals.stop();
      const laitelaBefore = GameSaveSerializer.serialize(player);
      AutoLaitela.status = "Player status";
      Object.assign(GlyphSolver.settings, { seconds: 5, screenTicks: 4, refineTicks: 8, refineCount: 2,
        target: "laitelaProgress", workers: 0, exhaustive: true });
      await GlyphSolver.solve();
      const laitelaRun = GlyphSolver.status.lastRun;
      check(!GlyphSolver.status.error, `Lai'tela solve finished without error ${GlyphSolver.status.error}`);
      check(laitelaRun.settings.laitela && laitelaRun.results.length === 20 &&
        laitelaRun.results.every(r => r.values.laitela && r.values.laitelaProgress instanceof Decimal),
      "Every loadout of a Lai'tela solve reports its Lai'tela outcome");
      const restoredLaitela = sameSave(laitelaBefore, GameSaveSerializer.serialize(player));
      check(restoredLaitela.same, `The save is restored exactly after a Lai'tela solve ${restoredLaitela.paths}`);
      check(AutoLaitela.status === "Player status" && !AutoLaitela.isActive,
        "Auto Lai'tela's own state is put back after solving on the page");
      Object.assign(GlyphSolver.settings, { laitela: false, target: "antimatter" });

      Currency.antimatter.value = new Decimal(1e10);
      const amBefore = Currency.antimatter.value;
      simulateTime(20, false, true);
      GameIntervals.stop();
      check(Currency.antimatter.value.gt(amBefore), "Fast offline simulation still produces resources");
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
