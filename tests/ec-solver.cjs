/* Browser integration checks for the Eternity Challenge strategy solver. */
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
      const fixture = ({ bulk = false, tt = 20000 } = {}) => {
        GameStorage.offlineEnabled = false;
        GameStorage.loadPlayerObject(Player.defaultStart);
        GameIntervals.stop();
        Modal.hideAll();
        Quote.clearAll();
        player.hasSeenIntro = true;
        player.introFrozen = false;
        player.break = true;
        Currency.realities.value = new Decimal(20);
        Currency.eternities.value = new Decimal(1e6);
        Currency.eternityPoints.value = new Decimal("1e100");
        Currency.timeTheorems.value = new Decimal(tt);
        NormalChallenges.completeAll();
        player.reality.perks.add(Perk.studyECRequirement.id);
        if (bulk) player.reality.perks.add(Perk.studyECBulk.id);
      };

      fixture({ bulk: true });
      check(ECSolver.goal(2, 5).eq(EternityChallenge(2).goalAtCompletions(4)),
        "With bulk completion the goal is the target tier, reached in one run");
      check(ECSolver.goal(2, 2).eq(EternityChallenge(2).goalAtCompletions(1)), "Lower targets ask for lower tiers");
      fixture();
      check(ECSolver.goal(2, 5).eq(EternityChallenge(2).goalAtCompletions(0)),
        "Without bulk completion the goal is the next single completion");

      fixture({ bulk: true });
      player.celestials.alpha.run = true;
      player.celestials.alpha.stage = 22;
      check(ECSolver.defaultChallenge.id === 11 && ECSolver.defaultChallenge.target === 5,
        "Alpha stage 22 defaults to EC11 with five completions");
      check(ECSolver.goal(11, 1).eq(EternityChallenge(11).currentGoal) && ECSolver.goal(11, 1).eq("1e7800"),
        "Alpha stage 22 pins EC11 to the forced five-tier goal of 1e7800 IP");
      check(ECSolver.isAlphaForcedBulk, "The forced bulk completion is reported");
      player.celestials.alpha.run = false;
      player.celestials.alpha.stage = 0;

      fixture();
      for (const id of [1, 2, 3, 10]) EternityChallenge(id).completions = 1;
      const plan = ECSolver.defaultPlan(11);
      for (const split of [231, 232]) {
        const tree = ECSolver.tree({ ...plan, split231: split }, 11);
        check(!tree.reason && tree.studies.some(s => s.id === split) && tree.exportString.endsWith("|11"),
          `A tree through study ${split} reaches EC11`);
      }
      check(ECSolver.tree(ECSolver.defaultPlan(2), 2).reason === "", "The default EC2 plan reaches its study");
      fixture({ tt: 10 });
      check(ECSolver.tree(ECSolver.defaultPlan(11), 11).reason !== "", "Trees that cannot reach the EC are rejected");

      // Entering an EC resets everything, so a goal of 1 IP (already held) checks the real trial path end to end
      fixture();
      GameStorage.loadPlayerObject(GameSaveSerializer.deserialize(GameSaveSerializer.serialize(player)));
      GameIntervals.stop();
      const before = GameSaveSerializer.serialize(player);
      const realGoal = ECSolver.goal;
      ECSolver.goal = () => new Decimal(1);
      Object.assign(ECSolver.settings, {
        ec: 2, target: 1, seconds: 30, screenTicks: 10, confirmTicks: 20, confirmCount: 2, maxRounds: 2,
        useTimeFlow: false, workers: 0, groups: { tree: false, crunch: true, replicanti: false, limits: false },
      });
      try {
        await ECSolver.solve();
      } finally {
        ECSolver.goal = realGoal;
      }
      let run = ECSolver.status.lastRun;
      check(!ECSolver.status.error, `Solve finished without error ${ECSolver.status.error}`);
      check(run.entries.length > 0 && run.entries.every(e => !e.failed && e.reachedAt !== null),
        "Every real trial enters the challenge and stops as soon as the goal is reached");
      check(run.recommended.ticks === 20, "The recommendation comes from the confirmation pass");
      const keys = run.entries.map(e => e.key);
      check(new Set(keys).size === keys.length && run.entries.filter(e => e.ticks === 20).length === 2,
        "Each plan is reported once, at the most accurate tick count it was run with");
      check(run.entries.every(e => e.choices.filter(c => c.group !== "crunch" && c.group !== "tree")
        .every(c => c.label === "Your current setting")), "Autobuyer levers that were not searched are left alone");
      check(run.entries.every(e => e.choices.filter(c => c.group === "tree")
        .every(c => c.label !== "Your current setting")), "The tree is always described, as it is always bought");
      const restored = sameSave(before, GameSaveSerializer.serialize(player));
      check(restored.same, `The save is restored exactly after solving ${restored.paths}`);
      check(EternityChallenge(2).completions === 0 && !EternityChallenge.isRunning,
        "Solving never awards completions or leaves the player inside the challenge");
      check(!SolverHarness.isSimulating && GameStorage.canSave(), "Saving is allowed again after solving");

      // With a known scoring rule, coordinate descent must find the best option of every searched lever
      const realTrial = ECSolver.runTrial;
      let trials = 0;
      const score = choice => (choice.crunch.xHighest === 1e100 ? 10 : 0) + (choice.replicantiGalaxies ? 0 : 5) +
        (choice.limits === "noGalaxies" ? 3 : 0);
      ECSolver.runTrial = (base, choice, { ticks }) => {
        trials++;
        const result = { failed: false, reason: "", reachedAt: null, finalLog: score(choice), samples: [], ticks };
        return Promise.resolve(result);
      };
      Object.assign(ECSolver.settings, {
        confirmTicks: 20, groups: { tree: false, crunch: true, replicanti: true, limits: true },
      });
      try {
        await ECSolver.solve();
      } finally {
        ECSolver.runTrial = realTrial;
      }
      run = ECSolver.status.lastRun;
      const labels = Object.fromEntries(run.recommended.choices.map(c => [c.key, c.label]));
      check(labels.crunch === "×1e100 highest IP" && labels.replicantiGalaxies === "Off" &&
        labels.limits === "No Antimatter Galaxies", "Coordinate descent finds the best option of every lever");
      check(trials === run.entries.length + 2, "Each distinct plan is screened once, and the best two confirmed once");
      // Each round tries the 7 single-lever changes plus one combination; the second round finds no improvement
      check(trials <= 1 + 2 * (7 + 1) + 2, `The search stays small (${trials} trials for three levers)`);
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
