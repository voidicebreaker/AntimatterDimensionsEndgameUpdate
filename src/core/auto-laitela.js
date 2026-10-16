// Repeats Lai'tela's Reality for as long as each run destabilizes it (completes in under 30 seconds), Hadronizing
// whenever it is fully destabilized. Once a run passes 30 seconds without completing it can no longer destabilize, so
// the automation stops there and leaves the player in that run.
const DESTABILIZE_SECONDS = 30;
const LOG_LENGTH = 12;

export const AutoLaitela = {
  isActive: false,
  // True while a run this automation is watching is in progress
  watching: false,
  status: "",
  log: [],

  get unavailableReason() {
    if (!Laitela.isUnlocked) return "Unlock Lai'tela first.";
    if (Pelle.isDoomed || Slabdrill.isCursed) return "Lai'tela's Reality cannot be entered in this run.";
    if (player.disablePostReality) return "Celestial Realities are unavailable in this run.";
    if (GameEnd.creditsEverClosed) return "The game has ended.";
    if (ECScheduler.isRunning) return "Stop the EC scheduler first; both would start Realities.";
    return "";
  },

  get canHadronize() {
    return ExpansionPack.laitelaPack.isBought && !player.disablePostReality;
  },

  get runSeconds() {
    return Time.thisRealityRealTime.totalSeconds.toNumber();
  },

  start() {
    if (this.isActive || this.unavailableReason) return;
    this.isActive = true;
    this.log = [];
    // A run already in progress is watched rather than restarted
    this.watching = Laitela.isRunning;
    this.status = "Running";
  },

  stop(reason = "Stopped.") {
    this.isActive = false;
    this.watching = false;
    this.status = reason;
  },

  record(text) {
    this.log.unshift({ text, time: Date.now() });
    if (this.log.length > LOG_LENGTH) this.log.length = LOG_LENGTH;
  },

  // The same steps as confirming Lai'tela's Reality in the celestial entry dialog
  enterRun() {
    beginProcessReality(getRealityProps(true));
    Laitela.initializeRun();
    this.watching = true;
  },

  // Called once per game tick, after Lai'tela's own completion check
  tick() {
    if (!this.isActive || SolverHarness.isSimulating) return;
    const reason = this.unavailableReason;
    if (reason) {
      this.stop(`Stopped: ${reason}`);
      return;
    }
    if (this.watching) this.watchRun();
    else this.startNextRun();
  },

  watchRun() {
    const dimensions = Laitela.maxAllowedDimension;
    if (Laitela.isRunning) {
      if (this.runSeconds >= DESTABILIZE_SECONDS) {
        this.stop(`Stopped: the run with ${formatInt(dimensions)} active Dimensions passed ${formatInt(30)} seconds, ` +
          "so it can no longer destabilize. You are still in it.");
      }
      return;
    }
    this.watching = false;
    // Completing the Reality marks entropy as -1 until the next Reality; anything else means the player left
    if (player.celestials.laitela.entropy.gte(0)) {
      this.stop("Stopped: you left Lai'tela's Reality.");
      return;
    }
    const seconds = player.celestials.laitela.thisCompletion;
    if (seconds < DESTABILIZE_SECONDS) {
      this.record(`Destabilized in ${TimeSpan.fromSeconds(new Decimal(seconds)).toStringShort()}, ` +
        `now ${formatInt(Laitela.maxAllowedDimension)} active Dimensions`);
    } else {
      this.stop(`Stopped: the last run took ${TimeSpan.fromSeconds(new Decimal(seconds)).toStringShort()}, ` +
        `too slow to destabilize.`);
    }
  },

  startNextRun() {
    if (Laitela.isFullyDestabilized) {
      if (!this.canHadronize) {
        this.stop("Stopped: fully destabilized, and Hadronizing needs Lai'tela's Expansion Pack.");
        return;
      }
      Laitela.hadronize();
      this.record(`Hadronized (${formatInt(Laitela.hadronizes)} total)`);
    }
    this.enterRun();
  },
};
