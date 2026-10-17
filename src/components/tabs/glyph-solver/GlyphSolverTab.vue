<script>
export default {
  name: "GlyphSolverTab",
  data() {
    return {
      unavailableReason: "",
      slots: 0,
      maxSpecial: 1,
      pool: [],
      loadoutCount: 0,
      needsRestart: false,
      canForceRestart: false,
      canMeasureLaitela: false,
      settings: { ...GlyphSolver.settings },
      running: false,
      phase: "",
      done: 0,
      total: 0,
      workDone: 0,
      workTotal: 0,
      elapsed: 0,
      parallel: false,
      workersInUse: 0,
      maxWorkers: SolverPool.maxSize,
      canUseWorkers: SolverPool.isSupported,
      note: "",
      error: "",
      lastRun: null,
      confirmApply: null,
      showAll: false,
      pollInterval: null,
    };
  },
  computed: {
    metrics() {
      return GLYPH_SOLVER_METRICS;
    },
    // Lai'tela metrics only mean something when the solve measures Lai'tela
    targetChoices() {
      const laitela = this.settings.laitela && this.canMeasureLaitela;
      return this.metrics.filter(m => laitela || !m.laitela);
    },
    measuredLaitela() {
      return Boolean(this.lastRun?.settings.laitela);
    },
    targetMetric() {
      return this.metrics.find(m => m.key === this.settings.target) ?? this.metrics[0];
    },
    // The most accurate runs first, as only the contenders were re-run at higher accuracy
    rankedResults() {
      if (!this.lastRun) return [];
      return rankGlyphSolverResults(this.lastRun.results, this.settings.target, true);
    },
    visibleResults() {
      return this.showAll ? this.rankedResults : this.rankedResults.slice(0, 25);
    },
    // Only show metrics that actually differ between loadouts, with the target first
    columns() {
      const results = this.lastRun?.results ?? [];
      const differs = metric => results.some(r => compareGlyphSolverMetric(metric,
        r.values[metric.key], results[0].values[metric.key]) !== 0);
      return [this.targetMetric, ...this.metrics.filter(m => m !== this.targetMetric && differs(m))];
    },
    // The best value reached in each column, which may come from a different loadout than the top-ranked one
    bestValues() {
      const best = {};
      for (const metric of this.metrics) {
        for (const result of this.lastRun?.results ?? []) {
          const value = result.values[metric.key];
          if (!(metric.key in best) || compareGlyphSolverMetric(metric, value, best[metric.key]) > 0) {
            best[metric.key] = value;
          }
        }
      }
      return best;
    },
    nonUniformTypes() {
      return this.pool.filter(p => p.cap > 0 && !p.isUniform).map(p => p.letter);
    },
    simulatedSpan() {
      return this.lastRun ? TimeSpan.fromSeconds(this.lastRun.seconds).toStringShort() : "";
    },
    // In simulated time, like simulatedSpan, so it includes Overclock time flow when the solve did
    laitelaSpan() {
      if (!this.measuredLaitela) return "";
      const { settings, seconds } = this.lastRun;
      return TimeSpan.fromSeconds(settings.laitelaSeconds * seconds / settings.seconds).toStringShort();
    },
    // Progress is measured in simulated ticks, since later rungs run far fewer but much longer trials
    progressPercent() {
      return this.workTotal === 0 ? 0 : 100 * this.workDone / this.workTotal;
    },
    eta() {
      if (this.workDone === 0) return "";
      const remaining = this.elapsed / this.workDone * (this.workTotal - this.workDone);
      return TimeSpan.fromSeconds(remaining).toStringShort();
    },
    trialRate() {
      return this.elapsed > 0 ? this.done / this.elapsed : 0;
    },
  },
  watch: {
    settings: {
      deep: true,
      handler(value) {
        Object.assign(GlyphSolver.settings, value, { excluded: [...value.excluded] });
      }
    },
    // Measuring Lai'tela is done to find the best Lai'tela loadout, so rank by it; stop ranking by it when turned off
    "settings.laitela"(measure) {
      const target = this.metrics.find(m => m.key === this.settings.target);
      if (measure && !target?.laitela) this.settings.target = "laitelaProgress";
      if (!measure && target?.laitela) this.settings.target = "antimatter";
    },
  },
  beforeDestroy() {
    clearInterval(this.pollInterval);
  },
  methods: {
    update() {
      this.unavailableReason = GlyphSolver.unavailableReason;
      this.slots = GlyphSolver.freeSlotCount;
      this.maxSpecial = GlyphSolver.maxSpecialGlyphs;
      this.pool = GlyphSolver.pool.map(p => ({
        type: p.type, letter: p.letter, owned: p.owned, cap: p.cap, excluded: p.excluded, isUniform: p.isUniform,
        synthesized: p.synthesized
      }));
      this.loadoutCount = GlyphSolver.loadoutCount;
      this.needsRestart = GlyphSolver.needsRestart;
      this.canForceRestart = PlayerProgress.realityUnlocked();
      this.canMeasureLaitela = GlyphSolver.canMeasureLaitela;
      const status = GlyphSolver.status;
      this.running = status.running;
      this.phase = status.phase;
      this.done = status.done;
      this.total = status.total;
      this.workDone = status.workDone;
      this.workTotal = status.workTotal;
      this.elapsed = status.running ? (Date.now() - status.startedAt) / 1000 : 0;
      this.parallel = status.parallel;
      this.workersInUse = status.workers;
      this.note = status.note;
      this.error = status.error;
      this.lastRun = status.lastRun;
    },
    typeTooltip(entry) {
      const standIn = entry.synthesized
        ? `, ${entry.synthesized} not owned yet (simulated as the best one you could make)` : "";
      return `${entry.type}: ${entry.owned} owned, up to ${entry.cap} equipped${standIn}`;
    },
    toggleType(type) {
      const excluded = this.settings.excluded;
      this.settings.excluded = excluded.includes(type) ? excluded.filter(t => t !== type) : [...excluded, type];
    },
    solve() {
      this.confirmApply = null;
      // The game UI does not update while trials run, so poll for progress until the solve finishes
      clearInterval(this.pollInterval);
      this.pollInterval = setInterval(() => this.update(), 250);
      GlyphSolver.solve().finally(() => {
        clearInterval(this.pollInterval);
        this.update();
      });
    },
    cancel() {
      GlyphSolver.cancel();
    },
    apply(result) {
      if (this.needsRestart && this.confirmApply !== result) {
        this.confirmApply = result;
        return;
      }
      this.confirmApply = null;
      GlyphSolver.apply(result.counts);
    },
    // What Auto Lai'tela did in this loadout's trial
    laitelaSummary(result) {
      const laitela = result.values.laitela;
      if (!laitela) return "";
      const hadronized = laitela.hadronizes > 0 ? `, Hadronized ×${formatInt(laitela.hadronizes)}` : "";
      if (laitela.outcome === "walled") {
        return `walls at ${formatInt(laitela.dimensionsLeft)} Dimensions${hadronized}`;
      }
      if (laitela.outcome === "running") return `still destabilizing at the end${hadronized}`;
      return `${laitela.note || "stopped"}${hadronized}`;
    },
    formatValue(metric, value) {
      if (metric.isTime) {
        return value === null || value === undefined ? "never" : TimeSpan.fromSeconds(value).toStringShort();
      }
      return format(value, 2, 2);
    },
    // How far this loadout is behind the best one, as a ratio for resources or extra time for milestones
    formatGap(metric, value) {
      const best = this.bestValues[metric.key];
      if (metric.isTime) {
        if (value === null || best === null) return "";
        return value === best ? "best" : `+${TimeSpan.fromSeconds(value - best).toStringShort()}`;
      }
      if (best.eq(0) || value.eq(best)) return "best";
      if (value.eq(0)) return "none";
      return `/${format(best.div(value), 2, 2)}`;
    },
  },
};
</script>

<template>
  <div class="c-glyph-solver">
    <div class="c-glyph-solver__intro">
      Tries every legal mix of Glyph types in your {{ formatInt(slots) }} free slots by running the real game forward
      on a copy of your save, with your autobuyers and Automator, then restores your save.
      Effarig and Reality Glyphs are limited to {{ formatInt(maxSpecial) }} each.
    </div>

    <div class="c-glyph-solver__types">
      <button
        v-for="entry in pool"
        :key="entry.type"
        class="o-primary-btn c-glyph-solver__type"
        :class="{ 'c-glyph-solver__type--off': entry.excluded }"
        :disabled="running"
        :title="typeTooltip(entry)"
        @click="toggleType(entry.type)"
      >
        {{ entry.letter }} ×{{ formatInt(entry.cap) }}<span v-if="entry.synthesized">*</span>
      </button>
    </div>

    <div class="c-glyph-solver__controls">
      <label>
        Simulate
        <input
          v-model.number="settings.seconds"
          type="number"
          min="1"
          class="c-glyph-solver__input"
          :disabled="running"
        >
        real seconds
      </label>
      <label v-if="!settings.exhaustive">
        Quick screen at
        <input
          v-model.number="settings.quickTicks"
          type="number"
          min="1"
          class="c-glyph-solver__input"
          :disabled="running"
        >
        ticks, then the best {{ formatPercents(settings.keepFraction) }} at
        <input
          v-model.number="settings.screenTicks"
          type="number"
          min="1"
          class="c-glyph-solver__input"
          :disabled="running"
        >
        ticks
      </label>
      <label v-else>
        Screen every loadout at
        <input
          v-model.number="settings.screenTicks"
          type="number"
          min="1"
          class="c-glyph-solver__input"
          :disabled="running"
        >
        ticks
      </label>
      <label>
        Re-run top
        <input
          v-model.number="settings.refineCount"
          type="number"
          min="0"
          class="c-glyph-solver__input"
          :disabled="running"
        >
        at
        <input
          v-model.number="settings.refineTicks"
          type="number"
          min="1"
          class="c-glyph-solver__input"
          :disabled="running"
        >
        ticks
      </label>
      <label>
        Rank by
        <select
          v-model="settings.target"
          class="o-primary-btn"
        >
          <option
            v-for="metric in targetChoices"
            :key="metric.key"
            :value="metric.key"
          >
            {{ metric.name }}
          </option>
        </select>
      </label>
      <label v-if="canMeasureLaitela">
        <input
          v-model="settings.laitela"
          type="checkbox"
          :disabled="running"
        >
        Measure Lai'tela: then run Auto Lai'tela for
        <input
          v-model.number="settings.laitelaSeconds"
          type="number"
          min="1"
          class="c-glyph-solver__input"
          :disabled="running || !settings.laitela"
        >
        real seconds
      </label>
      <label>
        <input
          v-model="settings.useTimeFlow"
          type="checkbox"
          :disabled="running"
        >
        Include Overclock time flow
      </label>
      <label>
        <input
          v-model="settings.exhaustive"
          type="checkbox"
          :disabled="running"
        >
        Exhaustive (slower; no quick screen)
      </label>
      <label v-if="canUseWorkers">
        CPU workers
        <input
          v-model.number="settings.workers"
          type="number"
          min="0"
          :max="maxWorkers"
          class="c-glyph-solver__input"
          :disabled="running"
        >
        (0 runs on this page and pauses the game)
      </label>
      <label v-if="canForceRestart">
        <input
          v-model="settings.forceRestart"
          type="checkbox"
          :disabled="running"
        >
        Always start from a restarted Reality
      </label>
    </div>

    <div>
      {{ formatInt(loadoutCount) }} loadouts.
      <span v-if="needsRestart">Each trial starts from a restart of this Reality, as swapping Glyphs would.</span>
      <span v-else>Each trial starts from this moment, since your slots are empty.</span>
    </div>
    <div v-if="pool.some(p => p.synthesized && p.cap)">
      * Not owned yet: Reality Glyphs are simulated at your Alchemy Reality level and Effarig Glyphs as all-effect
      Glyphs matching your best basic Glyph. Equipping creates the Reality Glyphs; Effarig ones you pick up yourself.
    </div>
    <div
      v-if="nonUniformTypes.length"
      class="c-glyph-solver__warning"
    >
      Your {{ nonUniformTypes.join(", ") }} Glyphs are not all identical; the strongest ones by level × rarity are used.
    </div>
    <div
      v-if="unavailableReason"
      class="c-glyph-solver__warning"
    >
      {{ unavailableReason }}
    </div>
    <div
      v-if="error"
      class="c-glyph-solver__warning"
    >
      {{ error }}
    </div>

    <button
      class="o-primary-btn c-glyph-solver__button"
      :disabled="Boolean(unavailableReason) || running"
      @click="solve"
    >
      Solve
    </button>

    <div
      v-if="lastRun"
      class="c-glyph-solver__results"
    >
      <div>
        Simulated {{ simulatedSpan }} per loadout<span v-if="measuredLaitela">, then up to {{ laitelaSpan }} of
          Auto Lai'tela (destabilizing and Hadronizing while each run takes under {{ formatInt(30) }} seconds)</span>.
        <span v-if="lastRun.cancelled">Cancelled; partial results.</span>
      </div>
      <div class="c-glyph-solver__table-wrapper">
        <table class="c-glyph-solver__table">
          <tr>
            <th>#</th>
            <th>Loadout</th>
            <th v-if="measuredLaitela">
              Lai'tela
            </th>
            <th
              v-for="metric in columns"
              :key="metric.key"
            >
              {{ metric.name }}
            </th>
            <th>Ticks</th>
            <th />
          </tr>
          <tr
            v-for="(result, index) in visibleResults"
            :key="result.name"
          >
            <td>{{ formatInt(index + 1) }}</td>
            <td class="c-glyph-solver__loadout">
              {{ result.name }}
            </td>
            <td v-if="measuredLaitela">
              {{ laitelaSummary(result) }}
            </td>
            <td
              v-for="metric in columns"
              :key="metric.key"
            >
              {{ formatValue(metric, result.values[metric.key]) }}
              <span class="c-glyph-solver__gap">{{ formatGap(metric, result.values[metric.key]) }}</span>
            </td>
            <td>{{ formatInt(result.ticks) }}</td>
            <td>
              <button
                class="o-primary-btn"
                :disabled="Boolean(unavailableReason) || running"
                @click="apply(result)"
              >
                {{ confirmApply === result ? "Restart and equip?" : "Equip" }}
              </button>
            </td>
          </tr>
        </table>
      </div>
      <button
        v-if="rankedResults.length > 25"
        class="o-primary-btn c-glyph-solver__button"
        @click="showAll = !showAll"
      >
        {{ showAll ? "Show top 25" : `Show all ${formatInt(rankedResults.length)}` }}
      </button>
    </div>

    <div
      v-if="note"
      class="c-glyph-solver__warning"
    >
      {{ note }}
    </div>

    <div
      v-if="running && parallel"
      class="c-glyph-solver__progress"
    >
      <b>Glyph Solver: {{ phase }}</b> on {{ formatInt(workersInUse) }} workers.
      {{ formatInt(done) }} / {{ formatInt(total) }} trials ({{ format(trialRate, 2, 2) }}/s)<span
        v-if="eta"
      >, about {{ eta }} left</span>.
      <div class="c-glyph-solver__bar">
        <div
          class="c-glyph-solver__bar-fill"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>
      You can keep playing; the solver works on a copy of your save.
      <button
        class="o-primary-btn c-glyph-solver__button"
        @click="cancel"
      >
        Cancel
      </button>
    </div>

    <div
      v-if="running && !parallel"
      class="c-glyph-solver__overlay"
    >
      <div class="c-glyph-solver__overlay-box">
        <b>Glyph Solver: {{ phase }}</b>
        <div>{{ formatInt(done) }} / {{ formatInt(total) }} trials<span v-if="eta">, about {{ eta }} left</span></div>
        <div class="c-glyph-solver__bar">
          <div
            class="c-glyph-solver__bar-fill"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
        <div>Your save is restored afterwards, and offline progress covers the time spent solving.</div>
        <button
          class="o-primary-btn c-glyph-solver__button"
          @click="cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.c-glyph-solver {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.8rem;
  width: 100%;
  line-height: 1.5;
}

.c-glyph-solver__intro {
  max-width: 80rem;
}

.c-glyph-solver__types,
.c-glyph-solver__controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 1rem;
}

.c-glyph-solver__type {
  min-width: 6rem;
}

.c-glyph-solver__type--off {
  opacity: 0.4;
  text-decoration: line-through;
}

.c-glyph-solver__input {
  width: 7rem;
}

.c-glyph-solver__warning {
  color: var(--color-bad);
}

.c-glyph-solver__results {
  width: 100%;
}

.c-glyph-solver__table-wrapper {
  max-width: 100%;
  overflow-x: auto;
}

.c-glyph-solver__table {
  border-collapse: collapse;
  margin: 0.5rem auto;
}

.c-glyph-solver__table th,
.c-glyph-solver__table td {
  border: 0.1rem solid var(--color-reality);
  padding: 0.2rem 0.6rem;
  white-space: nowrap;
}

.c-glyph-solver__loadout {
  font-family: monospace;
  font-weight: bold;
}

.c-glyph-solver__gap {
  opacity: 0.7;
  font-size: 0.85em;
}

.c-glyph-solver__overlay {
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

.c-glyph-solver__overlay-box {
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

.c-glyph-solver__bar {
  width: 30rem;
  height: 1rem;
  border: 0.1rem solid var(--color-reality);
}

.c-glyph-solver__bar-fill {
  height: 100%;
  background: var(--color-reality);
}

.c-glyph-solver__progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  border: var(--var-border-width, 0.2rem) solid var(--color-reality);
  border-radius: var(--var-border-radius, 0.5rem);
  padding: 1rem;
}

.c-glyph-solver__button {
  margin-top: 0.5rem;
}
</style>
