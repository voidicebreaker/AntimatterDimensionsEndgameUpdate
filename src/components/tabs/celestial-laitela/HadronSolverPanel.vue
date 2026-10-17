<script>
import GlyphHadronSolverBox from "@/components/tabs/glyph-solver/GlyphHadronSolverBox";

export default {
  name: "HadronSolverPanel",
  components: {
    GlyphHadronSolverBox,
  },
  data() {
    return {
      isOpen: false,
      unavailableReason: "",
      settings: { ...HadronSolver.settings },
      choiceCount: 0,
      currentSplit: "",
      running: false,
      phase: "",
      done: 0,
      total: 0,
      elapsed: 0,
      parallel: false,
      workersInUse: 0,
      maxWorkers: SolverPool.maxSize,
      canUseWorkers: SolverPool.isSupported,
      note: "",
      error: "",
      lastRun: null,
      canApplyBest: false,
      glyphsAvailable: false,
      canMeasureLaitela: false,
      combinedRunning: false,
      combinedReason: "",
      confirmingApply: false,
      pollInterval: null,
    };
  },
  computed: {
    alsoGlyphs() {
      return this.settings.alsoGlyphs && this.glyphsAvailable;
    },
    // A joint search with the Glyph Solver can only rank by what both solvers record
    metrics() {
      const metrics = this.alsoGlyphs
        ? GlyphHadronSolver.targets.filter(metric => this.canMeasureLaitela || !metric.laitela)
        : HADRON_SOLVER_METRICS;
      return metrics.map(metric => ({ key: metric.key, name: metric.name }));
    },
    busy() {
      return this.running || this.combinedRunning;
    },
    targetName() {
      return this.metrics.find(metric => metric.key === this.settings.target)?.name ?? "";
    },
    showTargetColumn() {
      const shown = ["laitelaProgress", "hadronizes", "darkMatter", "singularities", "antimatter"];
      return !shown.includes(this.settings.target);
    },
    // Re-ranked whenever the target changes, so one solve can be looked at from several angles
    entries() {
      return this.lastRun ? HadronSolver.rank(this.lastRun.entries, this.settings.target) : [];
    },
    best() {
      return this.entries[0] ?? null;
    },
    elapsedText() {
      return TimeSpan.fromSeconds(this.elapsed).toStringShort();
    },
    resetText() {
      return this.lastRun?.usesExotic ? "Endgame" : "Reality";
    },
  },
  watch: {
    settings: {
      deep: true,
      handler(value) {
        Object.assign(HadronSolver.settings, value);
      }
    },
    alsoGlyphs(joint) {
      if (joint && !this.metrics.some(metric => metric.key === this.settings.target)) {
        this.settings.target = this.metrics.some(metric => metric.key === "laitelaProgress")
          ? "laitelaProgress" : "antimatter";
      }
    },
  },
  beforeDestroy() {
    clearInterval(this.pollInterval);
  },
  methods: {
    update() {
      this.unavailableReason = HadronSolver.unavailableReason;
      this.choiceCount = this.unavailableReason ? 0 : HadronSolver.choices.length;
      this.currentSplit = Hadrons.describeSplit(Hadrons.split);
      const status = HadronSolver.status;
      this.running = status.running;
      this.phase = status.phase;
      this.done = status.done;
      this.total = status.total;
      this.elapsed = status.running ? (Date.now() - status.startedAt) / 1000 : 0;
      this.parallel = status.parallel;
      this.workersInUse = status.workers;
      this.note = status.note;
      this.error = status.error;
      this.lastRun = status.lastRun;
      this.canApplyBest = HadronSolver.canApply(this.best, this.lastRun) && !this.combinedRunning;
      this.glyphsAvailable = GlyphSolver.unavailableReason === "";
      this.canMeasureLaitela = GlyphSolver.canMeasureLaitela;
      this.combinedRunning = GlyphHadronSolver.status.running;
      this.combinedReason = this.alsoGlyphs ? GlyphHadronSolver.unavailableReason(this.settings.target) : "";
      if (!this.canApplyBest) this.confirmingApply = false;
    },
    solve() {
      this.confirmingApply = false;
      // The game UI does not update while trials run on the page, so poll for progress until the solve finishes
      clearInterval(this.pollInterval);
      this.pollInterval = setInterval(() => this.update(), 250);
      const solve = this.alsoGlyphs
        ? GlyphHadronSolver.solve({ target: this.settings.target, startWith: "hadrons" })
        : HadronSolver.solve();
      solve.finally(() => {
        clearInterval(this.pollInterval);
        this.update();
      });
    },
    cancel() {
      HadronSolver.cancel();
    },
    apply() {
      if (!this.confirmingApply) {
        this.confirmingApply = true;
        return;
      }
      this.confirmingApply = false;
      HadronSolver.apply(this.best);
    },
    describe(entry) {
      return HadronSolver.describeChoice(entry.choice, this.lastRun);
    },
    formatTime(seconds) {
      return TimeSpan.fromSeconds(new Decimal(seconds)).toStringShort();
    },
    outcome(entry) {
      const dimensions = `${formatInt(entry.dimensionsLeft)} active ${pluralize("Dimension", entry.dimensionsLeft)}`;
      if (entry.laitelaOutcome === "running") {
        return `Still destabilizing after ${this.formatTime(entry.laitelaTime)} (now ${dimensions})`;
      }
      if (entry.laitelaOutcome === "walled") {
        return `Walled at ${dimensions} after ${this.formatTime(entry.laitelaTime)}: needs ` +
          `${format(entry.antimatterNeeded, 2, 2)} antimatter, reached ${format(entry.antimatterReached, 2, 2)}`;
      }
      return entry.note;
    },
    // How a value compares with keeping the current split, as a ratio of orders of magnitude for huge numbers
    versusKeep(entry, key) {
      const keep = this.lastRun?.keep;
      if (!keep || entry === keep) return "";
      const value = entry.values[key];
      const base = keep.values[key];
      if (key === "laitelaProgress" || key === "hadronizes") {
        const diff = value.sub(base);
        return diff.eq(0) ? "" : ` (${diff.gt(0) ? "+" : ""}${format(diff, 2, 0)})`;
      }
      if (value.eq(base)) return "";
      return value.gt(base) ? " ▲" : " ▼";
    },
    recovery(entry) {
      if (entry.choice === HADRON_SOLVER_KEEP) return "No reset";
      // Resources the switch did not lower are back at once and not worth listing
      const lost = HADRON_SOLVER_RECOVERY.filter(resource => entry.recoveredAt[resource.key] !== 0);
      if (lost.length === 0) return "Nothing is lost";
      return lost.map(resource => {
        const seconds = entry.recoveredAt[resource.key];
        return `${resource.name}: ${seconds === null ? "not yet" : this.formatTime(seconds)}`;
      }).join(", ");
    },
  },
};
</script>

<template>
  <div class="c-hadron-solver">
    <div class="c-hadron-solver__header">
      <b>Hadron Solver</b>
      <button
        class="o-primary-btn"
        @click="isOpen = !isOpen"
      >
        {{ isOpen ? "Hide" : "Show" }}
      </button>
    </div>
    <template v-if="isOpen">
      <div class="c-hadron-solver__intro">
        Tries every Hadron split by running the real game on copies of your save: each try makes the switch (with its
        reset), lets your automation rebuild, records your resources, then runs Auto Lai'tela to see how far that split
        can destabilize and Hadronize. It only gives advice until you press Apply. Your split now:
        <b>{{ currentSplit }}</b>.
      </div>

      <div class="c-hadron-solver__controls">
        <label>
          Rank by
          <select
            v-model="settings.target"
            class="o-primary-btn"
          >
            <option
              v-for="metric in metrics"
              :key="metric.key"
              :value="metric.key"
            >
              {{ metric.name }}
            </option>
          </select>
        </label>
        <label>
          Rebuild for
          <input
            v-model.number="settings.rebuildSeconds"
            type="number"
            min="1"
            class="c-hadron-solver__input"
            :disabled="busy"
          >
          real seconds in
          <input
            v-model.number="settings.rebuildTicks"
            type="number"
            min="1"
            class="c-hadron-solver__input"
            :disabled="busy"
          >
          ticks
        </label>
        <label>
          Then Auto Lai'tela for up to
          <input
            v-model.number="settings.laitelaSeconds"
            type="number"
            min="1"
            class="c-hadron-solver__input"
            :disabled="busy"
          >
          real seconds
        </label>
        <label>
          <input
            v-model="settings.freshEndgame"
            type="checkbox"
            :disabled="busy"
          >
          Assume a fresh Endgame (Hadron effects start from zero)
        </label>
        <label>
          <input
            v-model="settings.useTimeFlow"
            type="checkbox"
            :disabled="busy"
          >
          Include Overclock time flow
        </label>
        <label v-if="glyphsAvailable">
          <input
            v-model="settings.alsoGlyphs"
            type="checkbox"
            :disabled="busy"
          >
          Also choose Glyphs: alternate with the Glyph Solver (its settings are on its tab) until neither changes its
          pick
        </label>
        <label v-if="canUseWorkers">
          CPU workers
          <input
            v-model.number="settings.workers"
            type="number"
            min="0"
            :max="maxWorkers"
            class="c-hadron-solver__input"
            :disabled="busy"
          >
          (0 runs on this page and pauses the game)
        </label>
      </div>

      <div
        v-if="unavailableReason"
        class="c-hadron-solver__warning"
      >
        {{ unavailableReason }}
      </div>
      <div
        v-if="error"
        class="c-hadron-solver__warning"
      >
        {{ error }}
      </div>
      <div
        v-if="note"
        class="c-hadron-solver__warning"
      >
        {{ note }}
      </div>
      <div
        v-if="combinedReason && !unavailableReason"
        class="c-hadron-solver__warning"
      >
        {{ combinedReason }}
      </div>

      <div
        v-if="running && parallel"
        class="c-hadron-solver__progress"
      >
        <b>Hadron Solver: {{ phase }}</b>
        on {{ formatInt(workersInUse) }} workers. {{ formatInt(done) }}/{{ formatInt(total) }} tries in
        {{ elapsedText }}. You can keep playing; the solver works on a copy of your save.
        <button
          class="o-primary-btn"
          @click="cancel"
        >
          Cancel
        </button>
      </div>

      <button
        class="o-primary-btn"
        :disabled="Boolean(unavailableReason || combinedReason) || busy"
        @click="solve"
      >
        {{ alsoGlyphs ? "Solve Glyphs + Hadrons" : `Solve (${formatInt(choiceCount)} splits)` }}
      </button>

      <GlyphHadronSolverBox />

      <div
        v-if="best"
        class="c-hadron-solver__result"
      >
        <b>Best by {{ targetName }}: {{ describe(best) }}</b>
        <span v-if="lastRun.cancelled">(cancelled; partial search)</span>
        <div>{{ outcome(best) }}</div>
        <div>Back to your current amounts after: {{ recovery(best) }}</div>
        <template v-if="canApplyBest">
          <button
            class="o-primary-btn"
            @click="apply"
          >
            {{ confirmingApply ? "Confirm: reset and switch" : "Apply this split" }}
          </button>
          <div
            v-if="confirmingApply"
            class="c-hadron-solver__warning"
          >
            Switching resets your Dark Matter, Dark Matter annihilation and Singularities, and restarts your
            {{ resetText }}, exactly like the buttons above.
          </div>
        </template>
      </div>

      <div
        v-if="entries.length"
        class="c-hadron-solver__table-wrapper"
      >
        <table class="c-hadron-solver__table">
          <tr>
            <th>#</th>
            <th>Split</th>
            <th>Lai'tela progress</th>
            <th>Lai'tela result</th>
            <th>Back to your current amounts after</th>
            <th v-if="showTargetColumn">
              {{ targetName }}
            </th>
            <th>Dark Matter</th>
            <th>Singularities</th>
            <th>Antimatter</th>
          </tr>
          <tr
            v-for="(entry, index) in entries"
            :key="`${entry.choice}-${entry.factor}`"
          >
            <td>{{ formatInt(index + 1) }}</td>
            <td>
              {{ describe(entry) }}
              <span v-if="entry.factor > 1">(confirmed)</span>
            </td>
            <td>
              {{ format(entry.values.laitelaProgress, 2, 0) }}{{ versusKeep(entry, "laitelaProgress") }}
              <span v-if="entry.values.hadronizes.gt(0)">
                ({{ format(entry.values.hadronizes, 2, 0) }} Hadronizes)
              </span>
            </td>
            <td class="c-hadron-solver__outcome">
              {{ outcome(entry) }}
            </td>
            <td class="c-hadron-solver__outcome">
              {{ recovery(entry) }}
            </td>
            <td v-if="showTargetColumn">
              {{ format(entry.values[settings.target], 2, 2) }}{{ versusKeep(entry, settings.target) }}
            </td>
            <td>{{ format(entry.values.darkMatter, 2, 2) }}{{ versusKeep(entry, "darkMatter") }}</td>
            <td>{{ format(entry.values.singularities, 2, 2) }}{{ versusKeep(entry, "singularities") }}</td>
            <td>{{ format(entry.values.antimatter, 2, 2) }}{{ versusKeep(entry, "antimatter") }}</td>
          </tr>
        </table>
        <div class="c-hadron-solver__note">
          Resources are measured after the {{ formatTime(lastRun.settings.rebuildSeconds) }} rebuild, before entering
          Lai'tela's Reality. ▲/▼ compare with keeping your current split, which skips the reset. Switching loses Dark
          Matter, its annihilation multiplier, Dark Matter Dimension ascensions and Singularities, which can take hours
          to build back up.
        </div>
      </div>

      <div
        v-if="running && !parallel && !combinedRunning"
        class="c-hadron-solver__overlay"
      >
        <div class="c-hadron-solver__overlay-box">
          <b>Hadron Solver: {{ phase }}</b>
          <div>{{ formatInt(done) }}/{{ formatInt(total) }} tries in {{ elapsedText }}</div>
          <div>Your save is restored afterwards, and offline progress covers the time spent solving.</div>
          <button
            class="o-primary-btn"
            @click="cancel"
          >
            Cancel
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.c-hadron-solver {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  max-width: 110rem;
  border: var(--var-border-width, 0.2rem) solid var(--color-laitela--accent, var(--color-text));
  border-radius: var(--var-border-radius, 0.5rem);
  margin: 1rem auto;
  padding: 1rem;
  line-height: 1.5;
}

.c-hadron-solver__header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.c-hadron-solver__intro {
  max-width: 80rem;
}

.c-hadron-solver__controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 1rem;
}

.c-hadron-solver__input {
  width: 7rem;
}

.c-hadron-solver__warning {
  color: var(--color-bad);
}

.c-hadron-solver__result {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  border: var(--var-border-width, 0.2rem) solid var(--color-laitela--accent, var(--color-text));
  border-radius: var(--var-border-radius, 0.5rem);
  padding: 1rem;
}

.c-hadron-solver__table-wrapper {
  max-width: 100%;
  overflow-x: auto;
}

.c-hadron-solver__table {
  border-collapse: collapse;
  margin: 0.5rem auto;
}

.c-hadron-solver__table th,
.c-hadron-solver__table td {
  border: 0.1rem solid var(--color-laitela--accent, var(--color-text));
  padding: 0.2rem 0.6rem;
}

.c-hadron-solver__table th {
  color: var(--color-text);
}

.c-hadron-solver__outcome {
  max-width: 35rem;
}

.c-hadron-solver__note {
  opacity: 0.8;
}

.c-hadron-solver__progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  border: var(--var-border-width, 0.2rem) solid var(--color-laitela--accent, var(--color-text));
  border-radius: var(--var-border-radius, 0.5rem);
  padding: 1rem;
}

.c-hadron-solver__overlay {
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

.c-hadron-solver__overlay-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  max-width: 50rem;
  border: var(--var-border-width, 0.2rem) solid var(--color-laitela--accent, var(--color-text));
  border-radius: var(--var-border-radius, 0.5rem);
  padding: 1.5rem;
  background: var(--color-base);
}
</style>
