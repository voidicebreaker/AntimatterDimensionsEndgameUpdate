// Finds a Glyph loadout and a Hadron split that suit each other by alternating the two solvers: the best loadout at a
// split, then the best split with that loadout, and so on until a solve picks what the other one was run with. Trying
// every pair would take far longer (thousands of loadouts times every split). Each solver keeps its own settings; this
// only hands each one the shared target and what the other one picked.
import { GLYPH_SOLVER_METRICS, GlyphSolver } from "./glyph-solver";
import { HADRON_SOLVER_KEEP, HADRON_SOLVER_METRICS, HadronSolver } from "./hadron-solver";

// Solves before giving up on agreement; alternating rarely needs more than three or four
const MAX_SOLVES = 6;

const sameCounts = (a, b) => Boolean(a && b) && a.length === b.length && a.every((n, i) => n === b[i]);

export const GlyphHadronSolver = {
  // Plain data for the UI to copy; results persist until the next run or a page reload
  status: {
    running: false,
    cancelRequested: false,
    // "glyphs" or "hadrons" while that solver runs
    solving: "",
    phase: "",
    startedAt: 0,
    error: "",
    lastRun: null,
  },

  // A joint search can only rank by something both solvers record
  get targets() {
    const hadronKeys = HADRON_SOLVER_METRICS.map(metric => metric.key);
    return GLYPH_SOLVER_METRICS.filter(metric => !metric.isTime && hadronKeys.includes(metric.key));
  },

  unavailableReason(target) {
    if (GlyphSolver.unavailableReason) return `Glyph Solver: ${GlyphSolver.unavailableReason}`;
    if (HadronSolver.unavailableReason) return `Hadron Solver: ${HadronSolver.unavailableReason}`;
    const metric = this.targets.find(m => m.key === target);
    if (!metric) {
      return "Rank by something both solvers record (such as Antimatter, Dark Matter, Singularities or Lai'tela " +
        "progress) to also choose the other.";
    }
    if (metric.laitela && !GlyphSolver.canMeasureLaitela) return "Lai'tela cannot be measured in this run.";
    return "";
  },

  // The equipped Glyphs as a Glyph Solver loadout
  get equippedCounts() {
    return GlyphSolver.pool.map(entry => player.reality.glyphs.active.filter(g => g.type === entry.type).length);
  },

  describeLoadout(counts) {
    return counts ? GlyphSolver.describe(counts) : "your current Glyphs";
  },

  describeSplit(split, run = this.status.lastRun) {
    return Hadrons.describeSplit(split, run?.usesExotic, run?.total);
  },

  // The solver whose panel started the search (startWith) runs first, at the other one's current choice
  async solve({ target, startWith = "glyphs" }) {
    if (this.status.running || SolverHarness.isBusy || this.unavailableReason(target)) return;
    const measuresLaitela = GLYPH_SOLVER_METRICS.find(m => m.key === target).laitela;
    Object.assign(this.status, {
      running: true, cancelRequested: false, solving: "", phase: "", startedAt: Date.now(), error: "",
    });
    const run = {
      target, startWith, usesExotic: Hadrons.usesExotic, total: Hadrons.hadrons.total, startSplit: Hadrons.split,
      solves: [], converged: false, cancelled: false, split: Hadrons.split,
      // The Hadron Solver's first solve, when it goes first, leaves the equipped Glyphs alone
      loadout: startWith === "hadrons" ? this.equippedCounts : null,
    };
    let next = startWith;
    try {
      for (let index = 0; index < MAX_SOLVES; index++) {
        const solve = next === "glyphs"
          ? await this.solveGlyphs(run, measuresLaitela)
          : await this.solveHadrons(run, index === 0);
        if (!solve) break;
        run.solves.push(solve);
        // A solve that picks what the other solver was just run with means each choice is the best for the other
        if (index > 0 && solve.unchanged) {
          run.converged = true;
          break;
        }
        next = next === "glyphs" ? "hadrons" : "glyphs";
      }
    } catch (error) {
      this.status.error = error.message || String(error);
      // eslint-disable-next-line no-console
      console.error(error);
    } finally {
      run.cancelled = this.status.cancelRequested;
      this.status.lastRun = Object.freeze(run);
      Object.assign(this.status, { running: false, solving: "", phase: "" });
    }
  },

  // Returns the solve's summary, or null if it did not finish
  async solveGlyphs(run, measuresLaitela) {
    this.status.solving = "glyphs";
    this.status.phase = `Choosing Glyphs at ${this.describeSplit(run.split, run)}`;
    const startedAt = Date.now();
    await GlyphSolver.solve({ target: run.target, split: run.split, ...(measuresLaitela ? { laitela: true } : {}) });
    const result = this.finishedRun(GlyphSolver.status, startedAt, "Glyph Solver");
    const best = result?.results[0];
    if (!best) return null;
    const unchanged = sameCounts(best.counts, run.loadout);
    run.loadout = best.counts;
    return { kind: "glyphs", at: run.split, choice: best.name, unchanged, value: best.values[run.target] };
  },

  async solveHadrons(run, isFirst) {
    this.status.solving = "hadrons";
    // Going first, the Hadron Solver keeps the equipped Glyphs; afterwards it tries the loadout the Glyph Solver chose
    const loadout = isFirst ? null : run.loadout;
    this.status.phase = `Choosing the Hadron split with ${this.describeLoadout(loadout)}`;
    const startedAt = Date.now();
    await HadronSolver.solve({ target: run.target, loadout });
    const result = this.finishedRun(HadronSolver.status, startedAt, "Hadron Solver");
    const best = result?.entries[0];
    if (!best) return null;
    const split = best.choice === HADRON_SOLVER_KEEP ? result.current : best.choice;
    const unchanged = split === run.split;
    run.split = split;
    return {
      kind: "hadrons", at: loadout ? GlyphSolver.describe(loadout) : null, choice: split, unchanged,
      value: best.values[run.target],
    };
  },

  // The solver's run if it finished after startedAt; anything else stops the search
  finishedRun(status, startedAt, name) {
    const result = status.lastRun;
    if (this.status.cancelRequested) return null;
    if (!result || result.finishedAt < startedAt) throw new Error(`${name} could not start.`);
    if (result.cancelled) return null;
    if (status.error) throw new Error(`${name}: ${status.error}`);
    return result;
  },

  cancel() {
    if (!this.status.running) return;
    this.status.cancelRequested = true;
    GlyphSolver.cancel();
    HadronSolver.cancel();
  },

  // Whether the found pair can still be applied: the Hadrons must be the ones the search was run with
  canApply(run = this.status.lastRun) {
    return Boolean(run?.loadout && run.solves.length) && !this.status.running && !SolverHarness.isBusy &&
      !GlyphSolver.unavailableReason && !HadronSolver.unavailableReason &&
      Hadrons.usesExotic === run.usesExotic && Hadrons.hadrons.total === run.total;
  },

  // Switches the split first, since switching after Divinity 3 restarts the Endgame and replaces the Glyphs
  apply(run = this.status.lastRun) {
    if (!this.canApply(run)) return false;
    if (run.split !== Hadrons.split && !Hadrons.setSplit(run.split)) return false;
    return GlyphSolver.apply(run.loadout);
  },
};
