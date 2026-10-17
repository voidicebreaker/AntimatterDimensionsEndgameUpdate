/* Browser integration checks for the Glyphs + Hadrons search, which alternates the Glyph and Hadron solvers. */
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
        delete object.speedrun.offlineTimeUsed;
        delete object.news;
        return JSON.stringify(object);
      };
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
      const equipped = () => GlyphSolver.describe(GlyphHadronSolver.equippedCounts);
      // Dark Hadrons unlocked with 5 Hadrons split 3/2, and Glyphs to choose from for the three slots
      const fixture = () => {
        AutoLaitela.stop("");
        GameStorage.offlineEnabled = false;
        GameStorage.loadPlayerObject(Player.defaultStart);
        GameIntervals.stop();
        Modal.hideAll();
        Quote.clearAll();
        player.hasSeenIntro = true;
        player.options.offlineProgress = false;
        player.realities = new Decimal(10);
        player.auto.autobuyersOn = false;
        player.reality.imaginaryUpgradeBits |= 1 << 15;
        for (const id of [15, 16, 17, 18, 19]) player.reality.dualityUpgradeBits |= 1 << id;
        Object.assign(hadrons(), { total: 5, light: 3, dark: 2, exotic: 0 });
        player.records.thisEndgame.realTime = 1e8;
        player.celestials.laitela.singularities = new Decimal(1e10);
        Currency.darkMatter.value = new Decimal(1e30);
        for (const type of ["power", "infinity", "time"]) {
          for (let i = 0; i < 3; i++) Glyphs.addToInventory(GlyphGenerator.endgameGlyph(type));
        }
        Currency.antimatter.value = new Decimal(1e10);
        buyMaxDimension(1);
        GameStorage.loadPlayerObject(GameSaveSerializer.deserialize(GameSaveSerializer.serialize(player)));
        GameIntervals.stop();
        Object.assign(GlyphSolver.settings, { excluded: ["effarig", "reality", "dilation", "replication"],
          seconds: 5, screenTicks: 4, refineTicks: 8, refineCount: 2, exhaustive: true, workers: 0,
          useTimeFlow: false, laitela: false, laitelaSeconds: 40, target: "antimatter" });
        Object.assign(HadronSolver.settings, { rebuildSeconds: 5, rebuildTicks: 5, laitelaSeconds: 40,
          confirmFactor: 1, freshEndgame: false, useTimeFlow: false, workers: 0, target: "antimatter" });
      };

      fixture();
      const targets = GlyphHadronSolver.targets.map(metric => metric.key);
      check(["antimatter", "darkMatter", "singularities", "laitelaProgress"].every(key => targets.includes(key)),
        "Resources and Lai'tela progress can rank a joint search");
      check(!targets.includes("firstReality") && !targets.includes("hadronizes") && !targets.includes("continuum"),
        "Metrics only one solver records cannot rank a joint search");
      check(GlyphHadronSolver.unavailableReason("antimatter") === "" &&
        GlyphHadronSolver.unavailableReason("hadronizes") !== "", "Only shared targets are accepted");
      check(GlyphSolver.loadoutCount === 10, "The fixture has 10 loadouts over three types");

      // A Hadron trial that also tries a loadout equips it after making its switch
      const original = GameSaveSerializer.serialize(player);
      SolverHarness.isSimulating = true;
      let trial;
      try {
        SolverHarness.restoreTrial(original);
        HadronSolver.prepareBase({ freshEndgame: false, loadout: [0, 3, 0, 0, 0, 0, 0] });
        const base = GameSaveSerializer.serialize(player);
        trial = await HadronSolver.runTrial(base, 5, { rebuildSeconds: 5, rebuildTicks: 5, laitelaSeconds: 10,
          laitelaTicks: 10, loadout: [0, 3, 0, 0, 0, 0, 0] });
        check(hadrons().light === 5 && equipped() === "III",
          "A Hadron trial with a loadout switches the split, then equips that loadout");
      } finally {
        SolverHarness.isSimulating = false;
      }
      check(trial.values.antimatter instanceof Decimal, "The trial records its resources");

      // A Glyph solve at another split starts its trials from that split
      SolverHarness.isSimulating = true;
      try {
        SolverHarness.restoreTrial(original);
        GlyphSolver.prepareBase({ split: 1 });
        check(hadrons().light === 1 && hadrons().dark === 4, "A Glyph solve at another split switches to it first");
      } finally {
        SolverHarness.isSimulating = false;
      }

      // The whole search on the page, started from the Glyph Solver
      fixture();
      const before = GameSaveSerializer.serialize(player);
      await GlyphHadronSolver.solve({ target: "antimatter", startWith: "glyphs" });
      let run = GlyphHadronSolver.status.lastRun;
      check(!GlyphHadronSolver.status.error, `The search finished without error ${GlyphHadronSolver.status.error}`);
      const kinds = run.solves.map(solve => solve.kind).join(",");
      check(run.solves.length >= 2 && kinds.startsWith("glyphs,hadrons") &&
        run.solves.every((solve, i) => i === 0 || solve.kind !== run.solves[i - 1].kind),
      `The two solvers alternate, starting with the Glyph Solver (${kinds})`);
      check(run.solves[0].at === 3, "The first Glyph solve runs at the current split");
      check(run.solves[1].at === run.solves[0].choice,
        "Each Hadron solve tries the loadout the Glyph Solver just chose");
      const last = run.solves[run.solves.length - 1];
      check(run.converged === last.unchanged && (run.converged || run.solves.length === 6),
        "The search stops once a solve keeps what the other was run with, or after six solves");
      check(GlyphSolver.status.lastRun.settings.split === run.split || last.kind === "hadrons",
        "The last Glyph solve ran at the split the search settled on");
      check(HadronSolver.status.lastRun.settings.loadout !== null, "Hadron solves after the first Glyph solve try a loadout");
      const restored = sameSave(before, GameSaveSerializer.serialize(player));
      check(restored.same, `The save is restored exactly after the search ${restored.paths}`);
      check(!SolverHarness.isSimulating && GameStorage.canSave(), "Saving is allowed again after the search");

      check(GlyphHadronSolver.canApply() && GlyphHadronSolver.apply(), "The found pair can be applied");
      check(Hadrons.split === run.split && equipped() === GlyphSolver.describe(run.loadout),
        "Applying switches to the split and equips the loadout");

      // Started from the Hadron Solver, the first solve keeps the equipped Glyphs
      fixture();
      GlyphSolver.apply([3, 0, 0, 0, 0, 0, 0]);
      // Confirmation rounds pick their leaders by the search's target, not by the Hadron panel's own Rank by
      Object.assign(HadronSolver.settings, { confirmFactor: 2, confirmCount: 2, target: "antimatter" });
      const rankedBy = new Set();
      const rank = HadronSolver.rank;
      HadronSolver.rank = function(entries, target) {
        rankedBy.add(target ?? this.settings.target);
        return rank.call(this, entries, target);
      };
      const equippedBefore = GameSaveSerializer.serialize(player);
      try {
        await GlyphHadronSolver.solve({ target: "darkMatter", startWith: "hadrons" });
      } finally {
        HadronSolver.rank = rank;
      }
      run = GlyphHadronSolver.status.lastRun;
      check(rankedBy.size === 1 && rankedBy.has("darkMatter"),
        `Every Hadron ranking in the search uses its target (${[...rankedBy].join(", ")})`);
      check(!GlyphHadronSolver.status.error, `The Hadron-first search finished ${GlyphHadronSolver.status.error}`);
      check(run.solves[0].kind === "hadrons" && run.solves[0].at === null && run.solves[1].kind === "glyphs",
        "Started from the Hadron Solver, the search first tries splits with the equipped Glyphs");
      check(run.solves[1].at === run.solves[0].choice, "The Glyph solve then runs at the split the Hadron Solver chose");
      const restoredEquipped = sameSave(equippedBefore, GameSaveSerializer.serialize(player));
      check(restoredEquipped.same, `The equipped save is restored after the search ${restoredEquipped.paths}`);

      // Lai'tela progress as the shared target turns on the Glyph Solver's Lai'tela measurement for the search
      fixture();
      GlyphSolver.settings.excluded = ["effarig", "reality", "dilation", "replication", "time"];
      await GlyphHadronSolver.solve({ target: "laitelaProgress", startWith: "glyphs" });
      run = GlyphHadronSolver.status.lastRun;
      check(!GlyphHadronSolver.status.error, `The Lai'tela search finished ${GlyphHadronSolver.status.error}`);
      check(GlyphSolver.status.lastRun.settings.laitela && GlyphSolver.status.lastRun.settings.target ===
        "laitelaProgress", "A Lai'tela target measures Lai'tela in the Glyph solves");
      check(!GlyphSolver.settings.laitela, "The Glyph Solver's own Lai'tela option is left as it was");

      // The same search in Web Workers
      fixture();
      const beforeParallel = GameSaveSerializer.serialize(player);
      GlyphSolver.settings.workers = 2;
      HadronSolver.settings.workers = 2;
      await GlyphHadronSolver.solve({ target: "antimatter", startWith: "glyphs" });
      run = GlyphHadronSolver.status.lastRun;
      check(!GlyphHadronSolver.status.error && !GlyphSolver.status.note && !HadronSolver.status.note,
        `The search runs in workers ${GlyphHadronSolver.status.error}${GlyphSolver.status.note}`);
      check(run.solves.length >= 2 && HadronSolver.status.lastRun.entries.every(e => e.values.antimatter instanceof
        Decimal), "Worker solves alternate and return every value as a Decimal");
      const untouched = sameSave(beforeParallel, GameSaveSerializer.serialize(player));
      check(untouched.same, `A worker search never touches the live save ${untouched.paths}`);
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
