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
      Object.assign(GlyphSolver.settings, { seconds: 5, screenTicks: 4, refineTicks: 8, refineCount: 2,
        target: "antimatter", useTimeFlow: false });
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
