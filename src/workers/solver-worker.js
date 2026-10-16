// A solver worker loads its own copy of the whole game and runs trials on demand, so the page stays responsive and
// several trials can run at once. Messages are { id, type, ... } and every reply carries the same id.
import "./worker-dom-shim";
import "@/shims";
import "@/merge-globals";

import { ElectronRuntime, SteamRuntime } from "@/steam";

// This copy of the game only ever simulates; it must never save, show anything or start its own game loop
SolverHarness.isSimulating = true;
GameIntervals.stop();
// The parts of the page's init() that game logic relies on; in a browser build both just mark themselves inactive
ElectronRuntime.initialize();
SteamRuntime.initialize();

const solvers = { glyph: GlyphSolver, ec: ECSolver, hadron: HadronSolver };
let base = null;

// Decimals cannot cross postMessage as class instances, so values travel as strings and are rebuilt on the page
const plain = value => {
  if (value instanceof Decimal) return { decimal: value.toString() };
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner)]));
  }
  return value;
};

const handlers = {
  // Builds the shared starting state for a solve from the live save
  prepare({ kind, original, settings }) {
    const solver = solvers[kind];
    Object.assign(solver.settings, settings);
    SolverHarness.restoreTrial(original);
    if (kind === "glyph") {
      if (solver.needsRestart && !solver.restartWithoutGlyphs()) {
        throw new Error("There is no inventory space to unequip your current Glyphs.");
      }
    } else {
      solver.prepareBase();
    }
    return GameSaveSerializer.serialize(player);
  },

  setBase({ save, seed, settings }) {
    base = save;
    SolverHarness.trialSeed = seed;
    for (const [kind, values] of Object.entries(settings)) Object.assign(solvers[kind].settings, values);
    return true;
  },

  // The study trees plans would buy from the starting state, used to skip plans which buy the same tree
  trees({ plans, ec }) {
    SolverHarness.restoreTrial(base);
    return plans.map(plan => {
      const tree = ECSolver.tree(plan, ec);
      return { key: ECSolver.planKey(plan, tree), exportString: tree.exportString, reason: tree.reason };
    });
  },

  async trial({ kind, choice, options }) {
    const result = await solvers[kind].runTrial(base, choice, options);
    return plain(result);
  },
};

self.onmessage = async({ data }) => {
  try {
    const result = await handlers[data.type](data);
    self.postMessage({ id: data.id, result });
  } catch (error) {
    self.postMessage({ id: data.id, error: error?.message ?? String(error) });
  }
};

self.postMessage({ type: "ready" });
