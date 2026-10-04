/* Browser integration checks. Run with a local dev/production server; no existing browser profile is used. */
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"]
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(process.env.SCHEDULER_TEST_URL || "http://127.0.0.1:8080/");
    await page.getByText("Start New Game", { exact: true }).waitFor();
    const checks = await page.evaluate(() => {
      const results = [];
      const check = (condition, message) => {
        if (!condition) throw new Error(message);
        results.push(message);
      };
      const fixture = ({ bulk = false, requirements = true, tt = 20000 } = {}) => {
        GameStorage.loadPlayerObject(Player.defaultStart);
        GameIntervals.stop();
        player.hasSeenIntro = true;
        player.introFrozen = false;
        player.break = true;
        Currency.realities.value = new Decimal(20);
        Currency.eternities.value = new Decimal(1e6);
        Currency.eternityPoints.value = new Decimal("1e100");
        Currency.timeTheorems.value = new Decimal(tt);
        NormalChallenges.completeAll();
        if (requirements) player.reality.perks.add(Perk.studyECRequirement.id);
        if (bulk) player.reality.perks.add(Perk.studyECBulk.id);
        player.reality.automator.forceUnlock = true;
      };
      const choose = (id, target = 5) => {
        ECScheduler.data.enabled.fill(false);
        ECScheduler.setEnabled(id, true);
        ECScheduler.setTarget(id, target);
      };
      const enter = id => {
        choose(id);
        check(ECScheduler.start(), `EC${id}: scheduler starts`);
        for (let i = 0; i < 8 && !EternityChallenge(id).isRunning; i++) ECScheduler.tick(50);
        check(EternityChallenge(id).isRunning, `EC${id}: entry is verified`);
      };

      fixture();
      check(!ECScheduler.plan(2).reason, "Early EC2 route works without the EC5 bypass perk");
      check(!ECScheduler.plan(2).studies.includes(TimeStudy(62)), "Locked optional Study 62 is excluded");
      check(Boolean(ECScheduler.plan(10).reason), "EC10 is deferred until Study 181 prerequisites exist");
      for (const id of [1, 2, 3, 10]) EternityChallenge(id).completions = 1;
      check(!ECScheduler.plan(11).reason && !ECScheduler.plan(12).reason, "Late EC routes become legal after prerequisites");
      check(!ECScheduler.setTree(2, "11|2!"), "Custom route rejects an EC start suffix");
      ECScheduler.setTarget(2, 999);
      check(ECScheduler.data.targets[1] === 5, "Targets are clamped to five");

      fixture();
      enter(2);
      const originalClock = JSON.stringify(player.overclock);
      Currency.infinityPoints.value = EternityChallenge(2).goalAtCompletions(4);
      ECScheduler.tick(50);
      check(EternityChallenge(2).completions === 1, "Without ECB, a five-tier IP goal claims exactly one tier");
      check(ECScheduler.data.log.some(e => e.message.includes("claimed 1 tier")), "Claim is logged after reward verification");
      check(JSON.stringify(player.overclock) === originalClock, "Scheduler leaves Overclock selections unchanged");
      check(!EternityChallenge.isRunning, "Claim exits the completed challenge");
      // The game itself changes reset timestamps/settings at Eternity. Pause/Stop must add no changes of their own.
      const afterResetAuto = JSON.stringify(player.auto);
      ECScheduler.pause();
      ECScheduler.stop();
      check(JSON.stringify(player.auto) === afterResetAuto, "Pause and Stop do not rewrite autobuyer settings");

      fixture({ bulk: true });
      enter(2);
      Currency.infinityPoints.value = EternityChallenge(2).goalAtCompletions(4);
      ECScheduler.tick(50);
      check(EternityChallenge(2).completions === 5, "ECB claims all five attainable tiers");
      check(!ECScheduler.isRunning, "Scheduler finishes when selected targets are complete");

      fixture();
      enter(2);
      EternityChallenge(2).completions = 5;
      ECScheduler.tick(50);
      check(!ECScheduler.isRunning && !EternityChallenge.isRunning && EternityChallenge(2).completions === 5,
        "Passive EC completion is re-read and releases the finished run without double rewards");

      fixture({ bulk: true });
      enter(2);
      Currency.infinityPoints.value = EternityChallenge(2).currentGoal;
      for (let i = 0; i < 8; i++) ECScheduler.tick(250);
      check(EternityChallenge(2).completions === 1, "ECB claims partial progress after the bulk waiting window");

      fixture({ requirements: false });
      player.totalTickGained = new Decimal(0);
      choose(2);
      ECScheduler.start();
      ECScheduler.tick(50);
      ECScheduler.tick(50);
      check(!EternityChallenge.isRunning && ECScheduler.data.phase === "prepare", "Missing entry requirement does not start an EC");
      check(ECScheduler.data.status.includes("Tickspeed"), "Missing entry requirement is explained");
      player.totalTickGained = new Decimal(1300);
      ECScheduler.tick(50);
      check(EternityChallenge(2).isRunning, "Preparation starts the EC when its live requirement becomes satisfied");

      fixture();
      TimeStudyTree.commitToGameState(new TimeStudyTree("11-61,antimatter,111,active,151-171").selectedStudies);
      choose(2);
      ECScheduler.start();
      ECScheduler.tick(50);
      Currency.infinityPoints.value = new Decimal("1e500");
      ECScheduler.tick(50);
      ECScheduler.tick(50);
      check(EternityChallenge(2).isRunning && TimeStudy(73).isBought && !TimeStudy(71).isBought,
        "Conflicting Dimension path is repaired through an actual respec Eternity");

      fixture();
      enter(2);
      ECScheduler.runtime.phaseTime = ECScheduler.limits.trial + 1;
      ECScheduler.tick(50);
      check(!EternityChallenge.isRunning && ECScheduler.runtime.cooldowns[2] > ECScheduler.runtime.elapsed,
        "A stalled EC exits and receives a bounded retry cooldown");
      check(EternityChallenge(2).completions === 0, "A timed-out attempt grants no completion");
      ECScheduler.data.phase = "farm";
      ECScheduler.runtime.farmTime = ECScheduler.limits.farm + 1;
      ECScheduler.tick(50);
      check(!ECScheduler.isRunning, "A session without progress eventually pauses instead of looping forever");

      fixture();
      OverclockUpgrade(7).isBought = true;
      enter(2);
      ECScheduler.tick(50);
      ECScheduler.runtime.phaseTime = ECScheduler.limits.trial + 1;
      ECScheduler.tick(50);
      const cooldown = ECScheduler.runtime.cooldowns[2];
      ECScheduler.tick(50);
      check(ECScheduler.runtime.cooldowns[2] === cooldown && ECScheduler.runtime.failures[2] === 1,
        "Rush Hour switching off on EC exit does not reset failure cooldowns");

      fixture();
      choose(2);
      ECScheduler.start();
      ECScheduler.tick(50);
      const ec = EternityChallenge(2);
      const originalStart = ec.start;
      ec.start = () => false;
      try { ECScheduler.tick(50); } finally { ec.start = originalStart; }
      check(!ec.isRunning && ec.completions === 0 && ECScheduler.runtime.cooldowns[2] > 0,
        "A refused challenge start is deferred without a false completion");

      fixture();
      enter(4);
      Currency.infinities.value = new Decimal(16);
      Currency.antimatter.value = new Decimal("1e100000");
      const beforeInfinities = Currency.infinities.value;
      ECScheduler.acting = true;
      ECScheduler.crunch();
      ECScheduler.acting = false;
      check(Currency.infinities.value.eq(beforeInfinities), "EC4 never Crunches past its Infinity budget");

      fixture();
      for (const id of [1, 2, 3, 10]) EternityChallenge(id).completions = 1;
      enter(11);
      check(TimeStudy(192).isBought, "EC11 includes uncapped Replicanti when affordable");
      Currency.antimatter.value = new Decimal("1e100000");
      ECScheduler.runtime.crunchTime = 100;
      const beforeAM = Currency.antimatter.value;
      ECScheduler.crunch();
      check(Currency.antimatter.value.eq(beforeAM) && EternityChallenge(11).isRunning,
        "EC11 uses passive IP instead of repeatedly Crunching away its progress");

      fixture();
      enter(8);
      Currency.antimatter.value = new Decimal("1e100000");
      Currency.infinityPoints.value = new Decimal("1e100000");
      ECScheduler.buyEC8();
      check(InfinityDimension(1).baseAmount.eq(10) && InfinityDimension(8).baseAmount.eq(490),
        "EC8 allocates one ID1 purchase and 49 ID8 purchases");
      check(player.eterc8ids === 0 && player.eterc8repl === 0, "EC8 respects both finite purchase budgets");
      check(player.replicanti.chance.eq(0.1) && player.replicanti.boughtGalaxyCap.eq(21),
        "EC8 uses the configured chance/interval allocation and spends the remainder on Galaxy cap");
      const repState = JSON.stringify(player.replicanti);
      ECScheduler.pause();
      ECScheduler.start();
      ECScheduler.buyEC8();
      check(JSON.stringify(player.replicanti) === repState, "Resuming EC8 does not spend its budget twice");

      fixture();
      for (const id of [1, 2, 3, 10]) EternityChallenge(id).completions = 1;
      enter(12);
      player.records.thisEternity.time = new Decimal(2000);
      check(EternityChallenge(12).tryFail(), "EC12 failure uses the game-time restriction");
      ECScheduler.tick(50);
      check(ECScheduler.isRunning && ECScheduler.runtime.cooldowns[12] > 0,
        "EC12 restriction failure is recovered without treating it as success");

      fixture();
      enter(2);
      ECScheduler.data.mode = "fast";
      ECScheduler.runtime.elapsed = 0;
      ECScheduler.tick(3600000);
      check(ECScheduler.runtime.elapsed === 0.25 && ECScheduler.isRunning,
        "A coarse offline tick cannot instantly exhaust the watchdog budget");
      for (const enabled of [false, true]) {
        Overclock.setEnabled(enabled);
        OverclockUpgrade(1).isBought = true;
        OverclockUpgrade(1).setEnabled(enabled);
        ECScheduler.tick(50);
        check(ECScheduler.isRunning, `Scheduler re-evaluates with Overclock ${enabled ? "on" : "off"}`);
      }
      check(ECScheduler.controlsAutobuyer(Autobuyer.eternity) &&
        ECScheduler.controlsAutobuyer(Autobuyer.reality) &&
        ECScheduler.controlsAutobuyer(Autobuyer.timeDimension(1)) &&
        !ECScheduler.controlsAutobuyer(Autobuyer.antimatterDimension(1)),
      "Conflicting prestige and currency purchases yield while Antimatter production remains available");
      EventHub.dispatch(GAME_EVENT.ETERNITY_RESET_BEFORE);
      check(!ECScheduler.isRunning, "Manual Eternity yields control immediately");
      ECScheduler.start();
      player.timestudy.studies.push(62);
      ECScheduler.tick(50);
      check(!ECScheduler.isRunning && ECScheduler.data.status.includes("manually"),
        "Manual study changes pause instead of being overwritten");

      fixture();
      enter(2);
      player.celestials.teresa.run = true;
      ECScheduler.tick(50);
      check(!ECScheduler.isRunning && ECScheduler.data.status.includes("special run"),
        "Unsupported celestial runs pause clearly");

      fixture();
      ECScheduler.buyResources();
      check(AntimatterDimension(1).amount.gt(0), "Fresh runs are seeded even with starting-resource achievements locked");

      fixture();
      const script = AutomatorScript.create("Scheduler test", "pause 10s");
      AutomatorBackend.initializeFromSave();
      AutomatorBackend.start(script.id);
      choose(2);
      ECScheduler.start();
      const timer = player.reality.automator.execTimer;
      AutomatorBackend.update(1000);
      check(player.reality.automator.execTimer === timer, "Automator execution is suspended during scheduler ownership");
      AutomatorBackend.start(script.id);
      check(!ECScheduler.isRunning, "Explicitly starting the Automator yields scheduler control");
      ECScheduler.start();
      AutomatorBackend.mode = AUTOMATOR_MODE.RUN;
      check(!ECScheduler.isRunning, "Resuming an existing Automator script yields scheduler control");

      fixture();
      choose(2, 3);
      ECScheduler.start();
      GameStorage.save();
      Tab.challenges.eternity.show(true);
      GameUI.update();
      return results;
    });
    await page.reload();
    await page.waitForFunction(() => window.ECScheduler && ECScheduler.isUnlocked);
    assert.deepEqual(await page.evaluate(() => {
      GameIntervals.stop();
      Tab.challenges.eternity.show(true);
      GameUI.update();
      return [ECScheduler.isRunning, ECScheduler.data.targets[1], ECScheduler.data.enabled[0],
        ECScheduler.data.status.includes("Loaded")];
    }), [false, 3, false, true]);
    checks.push("Reload preserves configuration and pauses for revalidation");
    await page.getByRole("region", { name: "Eternity Challenge scheduler" }).waitFor();
    await page.getByRole("checkbox", { name: "Include EC1", exact: true }).check();
    await page.getByRole("spinbutton", { name: "EC1 target completions", exact: true }).fill("2");
    await page.getByRole("spinbutton", { name: "EC1 target completions", exact: true }).press("Tab");
    assert.deepEqual(await page.evaluate(() => [ECScheduler.data.enabled[0], ECScheduler.data.targets[0]]), [true, 2]);
    checks.push("Visible individual toggle and completion target controls work");
    await page.getByRole("button", { name: "Start / Resume", exact: true }).click();
    assert.equal(await page.evaluate(() => ECScheduler.isRunning), true);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    assert.equal(await page.evaluate(() => ECScheduler.isRunning), false);
    checks.push("Visible Start and Pause controls work");
    await page.evaluate(() => {
      const old = GameSaveSerializer.deserialize(GameSaveSerializer.serialize(player));
      delete old.ecScheduler;
      GameStorage.loadPlayerObject(old);
      GameIntervals.stop();
    });
    assert.deepEqual(await page.evaluate(() => [ECScheduler.isRunning, ECScheduler.data.enabled.length,
      ECScheduler.data.targets.every(n => n === 5)]), [false, 12, true]);
    checks.push("Old saves receive safe scheduler defaults");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checks, pageErrors: errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
