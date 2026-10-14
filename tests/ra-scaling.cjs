/* Exercise production, wall-clock estimates, and the final signed upgrade bit in a real browser. */
const assert = require("node:assert/strict");

const { chromium } = require("playwright-core");

(async() => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"]
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(process.env.PULSE_TEST_URL || "http://127.0.0.1:8080/");
    await page.getByText("Start New Game", { exact: true }).waitFor();
    const checks = await page.evaluate(() => {
      const results = [];
      const check = (ok, label) => {
        if (!ok) throw new Error(label);
        results.push(label);
      };
      const near = (a, b) => new Decimal(a).div(b).sub(1).abs().lt(1e-9);
      GameStorage.offlineEnabled = false;
      GameStorage.loadPlayerObject(Player.defaultStart);
      GameIntervals.stop();
      const upgrade = OverclockUpgrade(31);
      Currency.realityMachines.value = new Decimal("1e25");
      check(!upgrade.purchase(), "Singularity is locked before Ra");
      V.spaceTheorems = 36;
      check(!upgrade.purchase(), "Singularity requires Ra's Expansion Pack");
      player.endgame.expansionPacks.boughtPacks.add("raPack");
      player.records.bestAntimatterExponentOutsideDoom = new Decimal("1e100");
      for (const pet of Ra.pets.all) {
        if (pet.requiredUnlock) player.celestials.ra.unlocks.push(pet.requiredUnlock.id);
      }
      const pet = Ra.pets.v;
      pet.level = 60;
      Ra.pets.enslaved.level = 67;
      OverclockUpgrade(29).purchase();
      OverclockUpgrade(30).purchase();
      const base = pet.memoryProductionPerChunk;
      const budget = Currency.realityMachines.value;
      check(upgrade.purchase(), "Singularity can be purchased with the pack unlocked");
      check(near(Currency.realityMachines.value, budget.sub(upgrade.cost)), "Purchase deducts the advertised RM cost");
      check(!upgrade.purchase(), "Singularity cannot be purchased twice");
      check(near(pet.memoryProductionPerChunk, base.times(1000)), "Level 60 gets the full 1000x memory bonus");
      check(Ra.pets.enslaved.memorySingularityMultiplier.gt("1e30"), "Level 67 receives a substantial scaling bonus");
      const reference = Ra.memoryCostForLevel(60).div(pet.memorySingularityMultiplier);
      for (const level of [61, 67, 80, 99]) {
        pet.level = level;
        check(near(pet.requiredMemories.div(pet.memorySingularityMultiplier), reference),
          `Level ${level} cost growth is offset by its own production bonus`);
      }
      pet.level = 100;
      check(pet.isCapped && Decimal.isFinite(pet.memorySingularityMultiplier) &&
        pet.memorySingularityMultiplier.lt("1e300"), "The level cap sentinel never enters the multiplier");
      pet.level = 60;
      check(near(pet.memorySingularityMultiplier, 1000), "Changing level back invalidates the level cache");
      upgrade.setEnabled(false);
      check(near(pet.memoryProductionPerChunk, base), "Individual toggle removes the entire scaling bonus");
      upgrade.setEnabled(true);
      Overclock.setEnabled(false);
      check(pet.memorySingularityMultiplier.eq(1), "Master toggle disables Singularity");
      Overclock.setEnabled(true);
      player.speedrun.isActive = true;
      check(pet.memorySingularityMultiplier.eq(1), "Speedruns disable Singularity");
      player.speedrun.isActive = false;
      player.celestials.ra.run = true;
      Currency.infinityPower.value = new Decimal("1e1000000");
      player.reality.glyphs.sac.reality = new Decimal("1e100");
      pet.memoryChunks = new Decimal(1000);
      pet.memories = DC.D0;
      const chunks = pet.memoryChunksPerSecond;
      check(chunks.gt(0), "The production fixture generates chunks");
      const expected = pet.memoryProductionPerChunk.times(pet.memoryChunks.times(2).add(chunks.times(2)));
      check(near(Ra.timeToGoal(pet, expected).times(Overclock.timeFlow), 2),
        "Quadratic ETA uses Singularity and converts to online wall-clock time");
      pet.tick(2000, true);
      check(near(pet.memories, expected), "Actual integration applies Singularity exactly once");
      const storedChunks = pet.memoryChunks;
      const storedMemories = pet.memories;
      pet.tick(2000, false);
      check(pet.memoryChunks.eq(storedChunks) &&
        near(pet.memories.sub(storedMemories), storedChunks.times(pet.memoryProductionPerChunk).times(2)),
      "Real-time storage still produces boosted memories without generating chunks");
      player.celestials.ra.run = false;
      const linearTarget = pet.memoryChunks.times(pet.memoryProductionPerChunk).times(10);
      check(near(Ra.timeToGoal(pet, linearTarget).times(Overclock.timeFlow), 10), "Linear ETA works outside Ra");
      player.celestials.ra.run = true;
      const tinyGoal = pet.memoryChunks.times(pet.memoryProductionPerChunk).times(1e-20);
      check(near(Ra.timeToGoal(pet, tinyGoal).times(Overclock.timeFlow), 1e-20),
        "Tiny goals with large chunk pools retain a positive, accurate ETA");
      player.celestials.effarig.unlockBits |= 1 << EffarigUnlock.eternity.id;
      player.celestials.enslaved.isStoringReal = true;
      check(Enslaved.isStoringRealTime && near(Ra.timeToGoal(pet, linearTarget).times(Overclock.timeFlow), 10),
        "ETA excludes new chunks while storing real time inside Ra");
      player.celestials.enslaved.isStoringReal = false;
      player.celestials.ra.run = false;
      check(Ra.timeToGoal(pet, -1).eq(0), "Already-funded goals never show negative ETAs");
      pet.memoryChunks = DC.D0;
      check(!Decimal.isFinite(Ra.timeToGoal(pet, 100)), "Zero production never promises a finite ETA");
      OverclockUpgrade(29).setEnabled(false);
      upgrade.setEnabled(false);
      const roundTrip = GameSaveSerializer.deserialize(GameSaveSerializer.serialize(player));
      GameStorage.loadPlayerObject(roundTrip);
      GameIntervals.stop();
      check(upgrade.isBought && !upgrade.isEnabled && !OverclockUpgrade(29).isEnabled && OverclockUpgrade(30).isEnabled,
        "Signed purchase and toggle bits survive save/load without changing older upgrades");
      upgrade.setEnabled(true);
      check(OverclockUpgrade(29).isBought && OverclockUpgrade(30).isBought && upgrade.isEnabled,
        "Enabling bit 31 preserves the older purchases");
      GameStorage.loadPlayerObject(GameSaveSerializer.deserialize(GameSaveSerializer.serialize(Player.defaultStart)));
      GameIntervals.stop();
      check(!upgrade.isBought, "Old saves do not receive the new upgrade for free");
      V.spaceTheorems = 36;
      player.endgame.expansionPacks.boughtPacks.add("raPack");
      Currency.realityMachines.value = new Decimal("1e25");
      player.hasSeenIntro = true;
      player.introFrozen = false;
      Modal.hideAll();
      Quote.clearAll();
      Tab.overclock.upgrades.show(true);
      GameUI.update();
      return results;
    });
    const buy = page.getByRole("button", { name: "Buy Memory Singularity", exact: true });
    await buy.waitFor();
    await page.evaluate(() => {
      Modal.hideAll();
      Quote.clearAll();
      GameUI.update();
    });
    await buy.click();
    await page.getByRole("button", { name: "Memory Singularity: ON", exact: true }).waitFor();
    assert(await page.evaluate(() => OverclockUpgrade(31).isBought));
    checks.push("The Overclock UI offers and purchases the upgrade");
    assert.deepEqual(errors, []);
    console.log(`${checks.length} Ra scaling checks passed`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
