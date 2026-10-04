/* Runs real compiler, execution stack, scheduler, and reset APIs in an isolated browser save. */
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"]
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(process.env.SCHEDULER_TEST_URL || "http://127.0.0.1:8080/");
    await page.getByText("Start New Game", { exact: true }).waitFor();
    const checks = await page.evaluate(() => {
      const checks = [];
      const check = (ok, message) => { if (!ok) throw new Error(message); checks.push(message); };
      const fixture = () => {
        GameStorage.loadPlayerObject(Player.defaultStart);
        GameIntervals.stop();
        player.hasSeenIntro = true;
        player.introFrozen = false;
        player.break = true;
        Currency.realities.value = new Decimal(20);
        Currency.eternities.value = new Decimal(1e6);
        Currency.eternityPoints.value = new Decimal("1e100");
        Currency.timeTheorems.value = new Decimal(20000);
        NormalChallenges.completeAll();
        player.reality.perks.add(Perk.studyECRequirement.id);
        player.reality.automator.forceUnlock = true;
        player.reality.automator.state.repeat = false;
        player.reality.automator.state.forceRestart = false;
        player.reality.automator.state.followExecution = false;
        ECScheduler.data.enabled.fill(false);
        ECScheduler.setEnabled(2, true);
        ECScheduler.setTarget(2, 1);
      };
      const script = text => {
        check(!hasCompilationErrors(text), `Compiles: ${text.replaceAll("\n", " / ")}`);
        const script = AutomatorScript.create("EC command test", text);
        AutomatorBackend.initializeFromSave();
        AutomatorBackend.start(script.id);
        return script;
      };
      const update = () => AutomatorBackend.update(AutomatorBackend.currentInterval);
      const enter = () => {
        for (let i = 0; i < 8 && !EternityChallenge(2).isRunning; i++) ECScheduler.tick(50);
        check(EternityChallenge(2).isRunning, "Automator-owned scheduler enters EC2 through the real API");
      };
      const complete = () => {
        enter();
        Currency.infinityPoints.value = EternityChallenge(2).currentGoal;
        ECScheduler.tick(50);
        check(EternityChallenge(2).completions === 1 && !ECScheduler.isRunning,
          "Real completion releases scheduler ownership");
      };

      fixture();
      const valid = ["ec scheduler run", "EC SCHEDULER RUN FAST", "ec scheduler run balanced",
        "ec scheduler on all", "ec scheduler off EC 12", "ec scheduler target ec2 3",
        "ec scheduler target all 5"];
      for (const text of valid) {
        check(!hasCompilationErrors(text), `Accepts ${text}`);
        const converted = blockifyTextAutomator(text);
        check(converted.visitedBlocks === 1 && converted.validatedBlocks === 1,
          `Block conversion preserves ${text}`);
        check(!hasCompilationErrors(BlockAutomator.parseLines(converted.blocks).join("\n")),
          `Block conversion round trip compiles ${text}`);
      }
      for (const text of ["ec scheduler run turbo", "ec scheduler on", "ec scheduler on ec13",
        "ec scheduler off banana", "ec scheduler target ec1 0", "ec scheduler target ec2 6",
        "ec scheduler target all 1.5", "ec scheduler target all", "ec scheduler run fast extra"]) {
        check(hasCompilationErrors(text), `Rejects ${text}`);
      }
      check(!hasCompilationErrors("start ec2\nwait ec2 completions >= 1\nstudies nowait purchase 11-61"),
        "Existing EC commands still compile");
      const editor = CodeMirror(document.createElement("div"), { value: "ec scheduler r" });
      editor.setCursor(0, 14);
      check(CodeMirror.hint.anyword(editor).list.includes("ec scheduler run"), "Text editor suggests scheduler commands");

      script("ec scheduler off all\nec scheduler on ec2\nec scheduler target ec2 1\nec scheduler run fast\npause 10s");
      for (let i = 0; i < 4; i++) update();
      check(ECScheduler.automatorOwned && ECScheduler.data.mode === "fast" &&
        ECScheduler.data.enabled.filter(Boolean).length === 1, "Script configures and starts the scheduler");
      check(AutomatorBackend.currentLineNumber === 4, "Blocking run stays on its source line");
      const runtime = ECScheduler.runtime;
      AutomatorBackend.update(1e8);
      check(ECScheduler.runtime === runtime && AutomatorBackend.currentLineNumber === 4,
        "Large Overclock updates neither restart the scheduler nor skip its wait");
      complete();
      update();
      check(AutomatorBackend.currentLineNumber === 5 && AutomatorBackend.isRunning,
        "Successful completion continues exactly once to the following command");

      fixture();
      script("ec scheduler run\npause 10s");
      update();
      AutomatorBackend.pause();
      check(!ECScheduler.isRunning && !AutomatorBackend.isRunning && AutomatorBackend.currentLineNumber === 1,
        "Automator Pause pauses its scheduler without advancing");
      AutomatorBackend.mode = AUTOMATOR_MODE.RUN;
      update();
      check(ECScheduler.automatorOwned, "Automator Resume revalidates and restarts the same scheduler command");
      ECScheduler.stop();
      update();
      check(!AutomatorBackend.isRunning && AutomatorBackend.currentLineNumber === 1,
        "Panel Stop pauses the owning script without falsely completing its line");
      AutomatorBackend.mode = AUTOMATOR_MODE.RUN;
      update();
      ECScheduler.start();
      check(ECScheduler.isRunning && !ECScheduler.automatorOwned && !AutomatorBackend.isRunning,
        "Manual panel restart takes ownership and leaves the script paused");
      ECScheduler.stop();

      fixture();
      script("ec scheduler run\npause 10s");
      update();
      ECScheduler.changePhase("farm");
      ECScheduler.runtime.farmTime = ECScheduler.limits.farm + 1;
      ECScheduler.tick(50);
      check(!ECScheduler.isRunning && !AutomatorBackend.isRunning &&
        AutomatorBackend.stack.top.commandState.ecScheduler === "paused",
        "Exhausted farming budget pauses both systems with the wait intact");
      AutomatorBackend.mode = AUTOMATOR_MODE.RUN;
      update();
      check(ECScheduler.automatorOwned, "Explicit resume retries a failed scheduler session");
      AutomatorBackend.stop();
      check(!ECScheduler.isRunning && !AutomatorBackend.isOn, "Automator Stop cancels ownership before clearing stack");

      fixture();
      player.dilation.active = true;
      script("ec scheduler run\npause 10s");
      update();
      check(!ECScheduler.isRunning && !AutomatorBackend.isRunning && AutomatorBackend.currentLineNumber === 1,
        "Unsupported run pauses the script instead of silently continuing or retrying forever");
      player.dilation.active = false;
      AutomatorBackend.mode = AUTOMATOR_MODE.RUN;
      update();
      check(ECScheduler.automatorOwned, "Fixing the blocked condition allows explicit resume");

      fixture();
      script("ec scheduler run\npause 10s");
      update();
      EventHub.dispatch(GAME_EVENT.ETERNITY_RESET_BEFORE);
      check(!ECScheduler.isRunning && !AutomatorBackend.isRunning, "Manual prestige pauses the owning Automator too");

      fixture();
      script("ec scheduler run\npause 10s");
      EternityChallenge(2).completions = 1;
      update();
      check(AutomatorBackend.currentLineNumber === 2 && !ECScheduler.isRunning,
        "Already-complete targets skip without starting a new session");
      fixture();
      ECScheduler.data.enabled.fill(false);
      script("ec scheduler run\npause 10s");
      update();
      check(AutomatorBackend.currentLineNumber === 2, "Empty selections skip safely");

      fixture();
      script("if total completions < 60 {\nec scheduler run\n}\npause 10s");
      update();
      update();
      complete();
      update();
      update();
      check(AutomatorBackend.currentLineNumber === 4, "Completion resumes correctly out of a nested block");

      fixture();
      script("ec scheduler run\npause 10s");
      AutomatorBackend.mode = AUTOMATOR_MODE.SINGLE_STEP;
      update();
      check(!ECScheduler.isRunning && !AutomatorBackend.isRunning && AutomatorBackend.currentLineNumber === 1,
        "Single-step neither skips a running scheduler command nor leaves it running unattended");
      AutomatorBackend.mode = AUTOMATOR_MODE.RUN;
      update();
      check(ECScheduler.automatorOwned, "Normal Run starts the single-stepped scheduler command");

      fixture();
      script("ec scheduler run\npause 10s");
      update();
      const saved = GameSaveSerializer.deserialize(GameSaveSerializer.serialize(player));
      GameStorage.loadPlayerObject(saved);
      GameIntervals.stop();
      check(!ECScheduler.isRunning && !AutomatorBackend.isRunning && AutomatorBackend.currentLineNumber === 1,
        "Save reload preserves the waiting line and pauses both systems");
      AutomatorBackend.mode = AUTOMATOR_MODE.RUN;
      update();
      check(ECScheduler.automatorOwned, "Saved scheduler command resumes using reconstructed live state");

      fixture();
      script("ec scheduler run\npause 10s");
      AutomatorBackend.state.forceRestart = true;
      for (let cycle = 1; cycle <= 2; cycle++) {
        update();
        complete();
        update();
        check(AutomatorBackend.currentLineNumber === 2, `Reality cycle ${cycle}: continues after completion`);
        finishProcessReality({ reset: true });
        check(EternityChallenge(2).completions === 0 && ECScheduler.data.targets[1] === 1,
          `Reality cycle ${cycle}: actual reset clears completions and preserves scheduler configuration`);
        update();
        check(ECScheduler.automatorOwned && AutomatorBackend.currentLineNumber === 1,
          `Reality cycle ${cycle}: Automator restarts scheduler without a manual activation`);
        // Supply the next cycle's progression fixture after testing the real reset and automatic start.
        player.break = true;
        Currency.eternities.value = new Decimal(1e6);
        Currency.eternityPoints.value = new Decimal("1e100");
        Currency.timeTheorems.value = new Decimal(20000);
        NormalChallenges.completeAll();
      }
      return checks;
    });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checks, pageErrors: errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
