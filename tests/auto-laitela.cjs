/* Browser integration checks for Auto Lai'tela. */
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
    const checks = await page.evaluate(() => {
      const results = [];
      const check = (condition, message) => {
        if (!condition) throw new Error(message);
        results.push(message);
      };
      const laitela = () => player.celestials.laitela;
      const fixture = () => {
        AutoLaitela.stop("");
        GameStorage.offlineEnabled = false;
        GameStorage.loadPlayerObject(Player.defaultStart);
        GameIntervals.stop();
        Modal.hideAll();
        Quote.clearAll();
        player.hasSeenIntro = true;
        player.realities = new Decimal(10);
        player.reality.imaginaryUpgradeBits |= 1 << 15;
      };
      // Makes the current Lai'tela run complete on the next tick, as if entropy had just filled up
      const completeRun = () => {
        laitela().entropy = new Decimal(1);
        gameLoop(50);
      };

      fixture();
      check(Laitela.isUnlocked && AutoLaitela.unavailableReason === "", "Auto Lai'tela is available once Lai'tela is");
      AutoLaitela.start();
      gameLoop(50);
      check(Laitela.isRunning && AutoLaitela.watching, "Starting enters Lai'tela's Reality");

      completeRun();
      check(Laitela.difficultyTier === 1, "A completion under 30 seconds destabilizes the Reality");
      check(AutoLaitela.log[0].text.startsWith("Destabilized"), "The destabilization is logged");
      check(Modal.message.isOpen === false, "No completion dialog appears while the automation runs");
      gameLoop(50);
      check(Laitela.isRunning && AutoLaitela.isActive, "It immediately enters the next run");

      laitela().difficultyTier = 7;
      completeRun();
      check(Laitela.isFullyDestabilized, "Destabilizing the last Dimension fully destabilizes the Reality");
      gameLoop(50);
      check(!AutoLaitela.isActive && AutoLaitela.status.includes("Expansion Pack"),
        "Without Lai'tela's Expansion Pack it stops at full destabilization and says why");

      player.endgame.expansionPacks.boughtPacks.add("laitelaPack");
      AutoLaitela.start();
      gameLoop(50);
      check(Laitela.hadronizes === 1 && Laitela.difficultyTier === 0 && Laitela.isRunning,
        "With the Expansion Pack it Hadronizes and starts again at full strength");
      check(AutoLaitela.log[0].text.startsWith("Hadronized"), "The Hadronize is logged");

      gameLoop(31000);
      check(!AutoLaitela.isActive && AutoLaitela.status.includes("passed 30 seconds"),
        "It stops once a run passes 30 seconds without completing");
      check(Laitela.isRunning, "The slow run is left going for the player");

      fixture();
      AutoLaitela.start();
      gameLoop(50);
      clearCelestialRuns();
      gameLoop(50);
      check(!AutoLaitela.isActive && AutoLaitela.status.includes("left"),
        "Leaving Lai'tela's Reality another way stops the automation");

      fixture();
      player.ecScheduler.running = true;
      check(AutoLaitela.unavailableReason.includes("EC scheduler"), "It refuses to run alongside the EC scheduler");
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
