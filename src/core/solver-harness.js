// Shared plumbing for solvers which try strategies by running the real game loop on throwaway copies of the save.
// While a solve is in progress, saving, modals, notifications and UI re-rendering are suppressed (see isSimulating),
// and the original save is restored afterwards with offline progress covering the time spent solving.

// Stop simulating for a frame after this many milliseconds so the progress display updates and Cancel works
const CHUNK_MS = 100;

const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));

export const SolverHarness = {
  isSimulating: false,
  // Every trial of a solve starts from the same random state, so strategies are compared on equal luck
  trialSeed: 1,
  // Name of the solver currently running, so two solvers never interleave their trials
  owner: null,

  get isBusy() {
    return this.owner !== null || this.isSimulating;
  },

  // Returns a session to hand back to end(), or null if another solver is already running
  begin(owner) {
    if (this.isBusy) return null;
    const session = {
      original: GameSaveSerializer.serialize(player),
      openTab: { tab: ui.view.tab, subtab: ui.view.subtab },
    };
    this.owner = owner;
    GameIntervals.stop();
    this.isSimulating = true;
    return session;
  },

  restoreSave(saveString, simulateOffline) {
    GameStorage.offlineEnabled = simulateOffline ? undefined : false;
    GameStorage.loadPlayerObject(GameSaveSerializer.deserialize(saveString));
    GameStorage.offlineEnabled = undefined;
    Enslaved.autoReleaseTick = 0;
    Quote.clearAll();
    // The offline progress summary for the restored save is worth showing; anything else came from a trial
    if (!simulateOffline) Modal.hideAll();
  },

  // Loads a trial's starting state; loading restarts the game intervals, which must stay off during a solve
  restoreTrial(base) {
    this.restoreSave(base, false);
    GameIntervals.stop();
    fastRandom.seed(this.trialSeed);
    normalDistribution.reset();
    GlyphGenerator.fakeSeed = this.trialSeed;
    GlyphGenerator.fakeSecondGaussian = null;
  },

  // Simulates the given real time in the given number of ticks. onStep(fraction) runs after every tick and may return
  // true to stop early. Resolves to "done", "stopped" or "cancelled".
  async runTicks({ seconds, ticks, onStep, isCancelled }) {
    const step = createSimulationStepper(seconds);
    let left = ticks;
    while (left > 0) {
      const chunkStart = Date.now();
      while (left > 0 && Date.now() - chunkStart < CHUNK_MS) {
        step(left);
        left--;
        if (onStep?.((ticks - left) / ticks)) return "stopped";
      }
      Modal.hideAll();
      await yieldFrame();
      if (isCancelled?.()) return "cancelled";
    }
    return "done";
  },

  // Restores the original save and returns an error message, or "" on success
  end(session) {
    let error = "";
    try {
      this.isSimulating = false;
      // Trials can switch tabs on prestige; go back before restoring so the offline summary is not closed
      const { tab, subtab } = session.openTab;
      if (ui.view.tab !== tab || ui.view.subtab !== subtab) {
        Tab[tab]?.subtabs.find(t => t.key === subtab)?.show(true);
      }
      // Real time kept passing while we solved; let normal offline progress catch the restored save up
      this.restoreSave(session.original, true);
    } catch (e) {
      // Never let a half-simulated state be autosaved over the real one
      this.isSimulating = true;
      error = `Could not restore your save (${e.message}). Reload the page; nothing was saved.`;
      // eslint-disable-next-line no-console
      console.error(e);
    }
    this.owner = null;
    return error;
  },
};
