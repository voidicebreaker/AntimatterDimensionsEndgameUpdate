<script>
// Progress and results of the Glyphs + Hadrons search, shown on both the Glyph Solver tab and Lai'tela's Hadron Solver
export default {
  name: "GlyphHadronSolverBox",
  data() {
    return {
      running: false,
      phase: "",
      solving: "",
      done: 0,
      total: 0,
      parallel: false,
      elapsed: 0,
      error: "",
      lastRun: null,
      canApply: false,
      confirmingApply: false,
      pollInterval: null,
    };
  },
  computed: {
    targetMetric() {
      return GLYPH_SOLVER_METRICS.find(metric => metric.key === this.lastRun?.target);
    },
    final() {
      const run = this.lastRun;
      if (!run?.loadout) return "";
      return `${GlyphSolver.describe(run.loadout)} with ${GlyphHadronSolver.describeSplit(run.split, run)}`;
    },
    elapsedText() {
      return TimeSpan.fromSeconds(new Decimal(this.elapsed)).toStringShort();
    },
    resetText() {
      return this.lastRun?.usesExotic ? "Endgame" : "Reality";
    },
  },
  created() {
    // The game UI does not update while trials run on the page, so this keeps its own clock
    this.pollInterval = setInterval(() => this.update(), 250);
  },
  beforeDestroy() {
    clearInterval(this.pollInterval);
  },
  methods: {
    update() {
      const status = GlyphHadronSolver.status;
      this.running = status.running;
      this.phase = status.phase;
      this.solving = status.solving;
      const solver = status.solving === "hadrons" ? HadronSolver.status : GlyphSolver.status;
      this.done = solver.done;
      this.total = solver.total;
      this.parallel = solver.parallel;
      this.elapsed = status.running ? (Date.now() - status.startedAt) / 1000 : 0;
      this.error = status.error;
      this.lastRun = status.lastRun;
      this.canApply = GlyphHadronSolver.canApply(this.lastRun);
      if (!this.canApply) this.confirmingApply = false;
    },
    cancel() {
      GlyphHadronSolver.cancel();
    },
    apply() {
      if (!this.confirmingApply) {
        this.confirmingApply = true;
        return;
      }
      this.confirmingApply = false;
      GlyphHadronSolver.apply(this.lastRun);
    },
    describeSolve(solve) {
      const run = this.lastRun;
      if (solve.kind === "glyphs") {
        return `Glyphs at ${GlyphHadronSolver.describeSplit(solve.at, run)}: ${solve.choice}`;
      }
      const loadout = solve.at ?? "your current Glyphs";
      return `Hadron split with ${loadout}: ${GlyphHadronSolver.describeSplit(solve.choice, run)}`;
    },
    formatValue(value) {
      return value instanceof Decimal ? format(value, 2, 2) : "";
    },
  },
};
</script>

<template>
  <div
    v-if="running || lastRun || error"
    class="c-glyph-hadron-solver"
  >
    <b>Glyphs + Hadrons</b>
    <template v-if="running">
      <div>
        {{ phase }}: {{ formatInt(done) }} / {{ formatInt(total) }} trials,
        {{ elapsedText }} so far.
      </div>
      <button
        class="o-primary-btn"
        @click="cancel"
      >
        Cancel
      </button>
    </template>
    <div
      v-if="error"
      class="c-glyph-hadron-solver__warning"
    >
      {{ error }}
    </div>
    <template v-if="lastRun && !running">
      <div v-if="final">
        <b>{{ lastRun.converged ? "Best together" : "Best found" }} by {{ targetMetric.name }}: {{ final }}</b>
      </div>
      <div v-if="lastRun.cancelled">
        Cancelled; this is the pair from the solves that finished.
      </div>
      <div v-else-if="!lastRun.converged && final">
        The solvers had not settled after {{ formatInt(lastRun.solves.length) }} solves; this is the last pair.
      </div>
      <ol class="c-glyph-hadron-solver__solves">
        <li
          v-for="(solve, index) in lastRun.solves"
          :key="index"
        >
          {{ describeSolve(solve) }}
          <span v-if="formatValue(solve.value)">({{ formatValue(solve.value) }})</span>
          <span v-if="solve.unchanged && index > 0"> - unchanged, so both agree</span>
        </li>
      </ol>
      <div class="c-glyph-hadron-solver__note">
        Each solve uses its own solver's settings and measures from its own starting point, so values from a Glyph solve
        and a Hadron solve are not comparable with each other.
      </div>
      <template v-if="canApply">
        <button
          class="o-primary-btn"
          @click="apply"
        >
          {{ confirmingApply ? "Confirm: switch and equip" : "Apply both" }}
        </button>
        <div
          v-if="confirmingApply"
          class="c-glyph-hadron-solver__warning"
        >
          Switching the split resets your Dark Matter, Dark Matter annihilation and Singularities and restarts your
          {{ resetText }}; equipping the Glyphs restarts your Reality.
        </div>
      </template>
    </template>

    <div
      v-if="running && !parallel"
      class="c-glyph-hadron-solver__overlay"
    >
      <div class="c-glyph-hadron-solver__overlay-box">
        <b>Glyphs + Hadrons: {{ phase }}</b>
        <div>{{ formatInt(done) }} / {{ formatInt(total) }} trials</div>
        <div>Your save is restored afterwards, and offline progress covers the time spent solving.</div>
        <button
          class="o-primary-btn"
          @click="cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.c-glyph-hadron-solver {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  max-width: 80rem;
  border: var(--var-border-width, 0.2rem) solid var(--color-reality);
  border-radius: var(--var-border-radius, 0.5rem);
  margin: 0.5rem auto;
  padding: 1rem;
  line-height: 1.5;
}

.c-glyph-hadron-solver__solves {
  text-align: left;
  margin: 0;
}

.c-glyph-hadron-solver__note {
  opacity: 0.8;
  font-size: 0.9em;
}

.c-glyph-hadron-solver__warning {
  color: var(--color-bad);
}

.c-glyph-hadron-solver__overlay {
  display: flex;
  justify-content: center;
  align-items: center;
  position: fixed;
  z-index: 10;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.6);
}

.c-glyph-hadron-solver__overlay-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  max-width: 50rem;
  border: var(--var-border-width, 0.2rem) solid var(--color-reality);
  border-radius: var(--var-border-radius, 0.5rem);
  padding: 1.5rem;
  background: var(--color-base);
}
</style>
