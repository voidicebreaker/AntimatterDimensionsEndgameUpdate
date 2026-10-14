/* Browser integration checks for Ra production and the stored-time dial optimizer. */
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
    await page.goto(process.env.PULSE_TEST_URL || "http://127.0.0.1:8080/");
    await page.getByText("Start New Game", { exact: true }).waitFor();
    const checks = await page.evaluate(() => {
      const results = [];
      const check = (condition, message) => {
        if (!condition) throw new Error(message);
        results.push(message);
      };
      const near = (a, b) => Math.abs(new Decimal(a).div(b).toNumber() - 1) < 1e-10;
      const fresh = () => {
        GameStorage.offlineEnabled = false;
        GameStorage.loadPlayerObject(Player.defaultStart);
        GameIntervals.stop();
        Modal.hideAll();
        Quote.clearAll();
      };

      fresh();
      Currency.realityMachines.value = new Decimal("1e20");
      check(!OverclockUpgrade(29).purchase() && !OverclockUpgrade(29).isBought,
        "Chunk upgrade cannot be purchased before Ra is unlocked");
      check(!OverclockUpgrade(30).purchase() && !OverclockUpgrade(30).isBought,
        "Memory upgrade cannot be purchased before Ra is unlocked");
      V.spaceTheorems = 36;
      player.celestials.ra.run = true;
      for (const pet of Ra.pets.all) {
        if (pet.requiredUnlock) player.celestials.ra.unlocks.push(pet.requiredUnlock.id);
      }
      Currency.eternityPoints.value = new Decimal("1e5000");
      Currency.infinityPower.value = new Decimal("1e1000000");
      Currency.timeShards.value = new Decimal("1e50000");
      player.reality.glyphs.sac.reality = new Decimal("1e100");
      const pet = Ra.pets.v;
      pet.memoryChunks = new Decimal(100);
      pet.memories = DC.D0;
      const baseChunks = pet.memoryChunksPerSecond;
      const baseMemories = Ra.productionPerMemoryChunk;
      check(baseChunks.gt(0), "V fixture generates chunks inside Ra");
      Currency.realityMachines.value = new Decimal(OverclockUpgrade(29).cost).add(OverclockUpgrade(30).cost).times(2);
      const budget = Currency.realityMachines.value;
      OverclockUpgrade(29).purchase();
      check(Currency.realityMachines.value.eq(budget.sub(OverclockUpgrade(29).cost)),
        "Chunk Accelerator pays its listed cost");
      check(near(pet.memoryChunksPerSecond, baseChunks.times(2)), "Chunk Accelerator doubles chunk production");
      check(Ra.productionPerMemoryChunk.eq(baseMemories), "Chunk Accelerator does not multiply memories a second time");
      OverclockUpgrade(30).purchase();
      check(near(Ra.productionPerMemoryChunk, baseMemories.times(3)), "Memory Accelerator triples memories per chunk");
      const expected = new Decimal(100).add(baseChunks).times(baseMemories).times(3);
      pet.tick(1000, true);
      check(near(pet.memories, expected), "Actual Ra tick applies both multipliers exactly once");
      check(near(pet.memoryChunks, new Decimal(100).add(baseChunks.times(2))), "Actual Ra tick receives twice the chunks");
      check(Ra.memoryBoostResources.includes("Memory Accelerator"), "Ra names the new memory production source");
      OverclockUpgrade(29).setEnabled(false);
      check(near(pet.memoryChunksPerSecond, baseChunks), "Individual chunk toggle removes its multiplier");
      OverclockUpgrade(29).setEnabled(true);
      Overclock.setEnabled(false);
      check(near(pet.memoryChunksPerSecond, baseChunks) && near(Ra.productionPerMemoryChunk, baseMemories),
        "Overclock master switch disables both Ra bonuses");
      Overclock.setEnabled(true);
      player.speedrun.isActive = true;
      check(near(pet.memoryChunksPerSecond, baseChunks) && near(Ra.productionPerMemoryChunk, baseMemories),
        "Speedruns receive neither Ra bonus");
      player.speedrun.isActive = false;
      player.celestials.ra.run = false;
      check(pet.memoryChunksPerSecond.eq(0), "Chunk upgrade does not generate chunks outside Ra");
      const beforeChunks = pet.memoryChunks;
      pet.tick(1000, false);
      check(pet.memoryChunks.eq(beforeChunks), "Chunk upgrade respects disabled chunk generation while storing real time");
      const saved = GameSaveSerializer.deserialize(GameSaveSerializer.serialize(player));
      GameStorage.loadPlayerObject(saved);
      GameIntervals.stop();
      check(OverclockUpgrade(29).isBought && OverclockUpgrade(30).isBought, "Both purchases survive save export and import");
      const oldSave = GameSaveSerializer.deserialize(GameSaveSerializer.serialize(Player.defaultStart));
      GameStorage.loadPlayerObject(oldSave);
      GameIntervals.stop();
      check(!OverclockUpgrade(29).isBought && !OverclockUpgrade(30).isBought, "Old saves do not get the new upgrades for free");

      // Independent per-tick reference, including the exact release-before-charge ordering used by gameLoop.
      const reference = (input, fraction, interval, horizon) => {
        let stored = new Decimal(input.stored);
        let released = DC.D0;
        let normal = DC.D0;
        let phase = input.phase;
        for (let tick = 0; tick < horizon; tick++) {
          phase++;
          if (phase >= interval) {
            phase = 0;
            released = released.add(Decimal.min(stored.times(fraction), input.cap));
            stored = stored.times(1 - fraction);
          } else {
            stored = Decimal.min(stored.add(input.chargePerTick), input.cap);
            normal = normal.add(input.normalPerTick);
          }
        }
        return { released, storedAfter: stored,
          averageSpeed: released.add(normal).div(horizon * input.tickMs).times(input.flow) };
      };
      const scalarScore = (input, fraction, interval, horizon) => {
        let stored = input.stored.toNumber();
        const cap = input.cap.toNumber();
        let total = 0;
        let phase = input.phase;
        for (let tick = 0; tick < horizon; tick++) {
          phase++;
          if (phase >= interval) {
            phase = 0;
            total += Math.min(stored * fraction, cap);
            stored = fraction === 1 ? 0 : stored * (1 - fraction);
          } else {
            stored = Math.min(stored + input.chargePerTick.toNumber(), cap);
            total += input.normalPerTick.toNumber();
          }
        }
        return total / (horizon * input.tickMs) * input.flow;
      };
      const fixture = overrides => ({ stored: new Decimal(230), cap: new Decimal(1000),
        chargePerTick: new Decimal(11), normalPerTick: new Decimal(3), tickMs: 50,
        flow: 5, phase: 2, fraction: 0.036, interval: 3, ...overrides });
      for (const input of [fixture({}), fixture({ cap: new Decimal(20) }),
        fixture({ stored: new Decimal("1e400"), cap: new Decimal(1000) }), fixture({ stored: DC.D0 })]) {
        for (const [fraction, interval] of [[1, 1], [1, 3], [1, 100], [0.036, 1], [0.2, 7]]) {
          const actual = BlackHolePulseOptimizer.project(input, { fraction, interval, horizon: 100 });
          const expectedProjection = reference(input, fraction, interval, 100);
          for (const key of ["released", "storedAfter", "averageSpeed"]) {
            check(actual[key].eq(expectedProjection[key]) || near(actual[key], expectedProjection[key]),
              `Pulse projection matches per-tick replay: ${key}, fraction ${fraction}, interval ${interval}`);
          }
        }
      }
      const steadyInput = fixture({ cap: new Decimal("1e50") });
      const steady = BlackHolePulseOptimizer.solve(steadyInput);
      check(steady.interval === 100 && steady.fraction === steadyInput.fraction,
        "Sustained optimizer maximizes charging ticks and preserves an equally effective release percentage");
      check(BlackHolePulseOptimizer.sustained(steadyInput, 1, 1).eq(0),
        "A one-tick release interval has no sustained production because it never charges");
      for (const input of [fixture({}), fixture({ cap: new Decimal(20) }),
        fixture({ stored: new Decimal("1e400"), cap: new Decimal(1000) })]) {
        const best = BlackHolePulseOptimizer.solve(input, "burst", 100);
        let exhaustive = 0;
        for (let interval = 1; interval <= 100; interval++) {
          for (let step = 1; step <= 500; step++) {
            const score = scalarScore(input, step / 500, interval, 100);
            if (score > exhaustive) exhaustive = score;
          }
        }
        check(near(best.averageSpeed, exhaustive), "Burst optimizer equals exhaustive search of all 50,000 legal dial pairs");
      }
      const capInput = fixture({ stored: new Decimal("1e400"), cap: new Decimal(1000) });
      const capped = BlackHolePulseOptimizer.solve(capInput, "burst", 100);
      check(capped.interval === 1 && capped.fraction < 1,
        "Optimizer preserves an oversized reservoir instead of wasting it in one capped release");

      fresh();
      player.endgame.expansionPacks.boughtPacks.add("enslavedPack");
      player.celestials.effarig.unlockBits |= 1 << EffarigUnlock.eternity.id;
      player.celestials.enslaved.isAutoReleasing = true;
      player.celestials.enslaved.stored = new Decimal(500);
      player.celestials.enslaved.pulseAmount = 0.036;
      player.celestials.enslaved.pulseTime = 3;
      Enslaved.autoReleaseTick = 2;
      check(!BlackHolePulseOptimizer.unavailableReason, "Optimizer is available with the pack and Pulse enabled");
      const before = JSON.stringify(player);
      const recommendation = BlackHolePulseOptimizer.analyze("burst", 100);
      check(JSON.stringify(player) === before, "Analyzing dials neither spends time nor changes the save");
      const storedBeforeApply = player.celestials.enslaved.stored;
      const applied = BlackHolePulseOptimizer.apply("burst", 100);
      check(applied && player.celestials.enslaved.pulseTime === applied.interval &&
        player.celestials.enslaved.pulseAmount === applied.fraction, "Apply changes both existing dials");
      check(player.celestials.enslaved.stored.eq(storedBeforeApply) && Enslaved.autoReleaseTick === 2,
        "Apply preserves the stored reservoir and pulse phase");
      check(recommendation !== null, "Preview returns an actionable result");
      player.celestials.enslaved.isStoringReal = true;
      const blockedSettings = JSON.stringify(player.celestials.enslaved);
      check(BlackHolePulseOptimizer.apply("burst", 100) === null &&
        JSON.stringify(player.celestials.enslaved) === blockedSettings, "Optimizer respects blocked real-time storage");
      player.celestials.enslaved.isStoringReal = false;
      player.celestials.enslaved.isAutoReleasing = false;
      check(BlackHolePulseOptimizer.analyze("sustained", 1000) === null, "Optimizer requires Pulse to be enabled");
      Enslaved.pulseTickDurationMs = 100000;
      GameStorage.loadPlayerObject(GameSaveSerializer.deserialize(GameSaveSerializer.serialize(player)));
      GameIntervals.stop();
      check(Enslaved.pulseTickDurationMs === 0, "Loading a save clears the previous tick measurement");
      return results;
    });
    await page.evaluate(() => {
      GameIntervals.stop();
      Modal.hideAll();
      Quote.clearAll();
      Currency.realities.value = DC.D1;
      player.hasSeenIntro = true;
      player.introFrozen = false;
      player.blackHole[0].unlocked = true;
      player.celestials.enslaved.isAutoReleasing = true;
      Tab.reality.hole.show(true);
      GameUI.update();
    });
    const optimizer = page.locator(".c-pulse-optimizer");
    await optimizer.waitFor({ state: "visible" });
    await page.evaluate(() => {
      Modal.hideAll();
      Quote.clearAll();
      GameUI.update();
    });
    await optimizer.getByRole("button", { name: "Find best release settings", exact: true }).click();
    assert(await optimizer.getByRole("button", { name: "Apply best release settings", exact: true }).isVisible());
    checks.push("The Black Hole tab shows an actionable recommendation");
    const storedBeforeApply = await page.evaluate(() => player.celestials.enslaved.stored.toString());
    await optimizer.getByRole("button", { name: "Apply best release settings", exact: true }).click();
    assert.equal(await page.evaluate(() => player.celestials.enslaved.stored.toString()), storedBeforeApply);
    checks.push("Applying from the UI changes settings without spending stored time");
    await optimizer.locator("select").first().selectOption("burst");
    await optimizer.getByRole("button", { name: "Find best release settings", exact: true }).click();
    assert(await optimizer.getByText(/Projected stored time remaining/u).isVisible());
    checks.push("The stored-time goal shows the projected remaining reservoir");
    await page.evaluate(() => {
      player.celestials.enslaved.isAutoReleasing = false;
      GameUI.update();
    });
    await optimizer.getByText("Turn on Pulse to optimize auto-release.", { exact: true }).waitFor();
    assert(await optimizer.getByRole("button", { name: "Find best release settings", exact: true }).isDisabled());
    checks.push("The UI disables optimization when Pulse is off");
    assert.deepEqual(errors, []);
    console.log(`${checks.length} Ra and pulse optimizer checks passed`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
