<script>
export default {
  name: "BlackHolePulseOptimizer",
  data() {
    return {
      mode: "sustained",
      horizon: 1000,
      recommendation: null,
      unavailableReason: "",
    };
  },
  computed: {
    improvement() {
      if (!this.recommendation || this.recommendation.currentSpeed.eq(0)) return null;
      return this.recommendation.averageSpeed.div(this.recommendation.currentSpeed);
    },
    remainingTime() {
      if (!this.recommendation || !this.recommendation.storedAfter) return "";
      const span = TimeSpan.fromMilliseconds(this.recommendation.storedAfter);
      return span.totalYears.gt(1e6)
        ? `${formatPostBreak(span.totalYears, 3, 2)} years` : span.toStringShort();
    },
    speedDisplay() {
      return this.recommendation ? `×${formatPostBreak(this.recommendation.averageSpeed, 2, 2)}` : "";
    },
  },
  methods: {
    update() {
      this.unavailableReason = BlackHolePulseOptimizer.unavailableReason;
    },
    analyze() {
      this.recommendation = BlackHolePulseOptimizer.analyze(this.mode, this.horizon);
    },
    apply() {
      this.recommendation = BlackHolePulseOptimizer.apply(this.mode, this.horizon);
    },
    clearRecommendation() {
      this.recommendation = null;
    },
  },
};
</script>

<template>
  <div class="c-pulse-optimizer">
    <b>Auto-release optimizer</b>
    <div class="c-pulse-optimizer__controls">
      <label>
        Optimize for:
        <select
          v-model="mode"
          class="o-primary-btn"
          @change="clearRecommendation"
        >
          <option value="sustained">Sustained speed</option>
          <option value="burst">Use stored time</option>
        </select>
      </label>
      <label v-if="mode === 'burst'">
        Over the next
        <select
          v-model.number="horizon"
          class="o-primary-btn"
          @change="clearRecommendation"
        >
          <option
            v-for="ticks in [100, 1000, 10000]"
            :key="ticks"
            :value="ticks"
          >
            {{ formatInt(ticks) }} ticks
          </option>
        </select>
      </label>
    </div>
    <div>
      <template v-if="mode === 'sustained'">
        Maximize average production after charging settles, keeping your release percentage when possible.
      </template>
      <template v-else>
        Maximize game time delivered within the selected ticks, including your existing stored time.
      </template>
      Estimates use your current charging rate and measured tick length.
    </div>
    <div
      v-if="unavailableReason"
      class="c-pulse-optimizer__status"
    >
      {{ unavailableReason }}
    </div>
    <button
      class="o-primary-btn c-pulse-optimizer__button"
      :disabled="Boolean(unavailableReason)"
      @click="analyze"
    >
      Find best release settings
    </button>
    <div
      v-if="recommendation"
      class="c-pulse-optimizer__result"
      aria-live="polite"
    >
      Release {{ formatPercents(recommendation.fraction, 2, 1) }} every
      {{ formatInt(recommendation.interval) }} ticks.
      <br>
      Estimated {{ mode === "sustained" ? "sustained" : "average" }} game speed:
      {{ speedDisplay }}.
      <span v-if="improvement">{{ formatX(improvement, 2, 2) }} the settings at analysis.</span>
      <template v-if="mode === 'burst'">
        <br>
        Projected stored time remaining: {{ remainingTime }}.
      </template>
      <br>
      <button
        class="o-primary-btn c-pulse-optimizer__button"
        :disabled="Boolean(unavailableReason)"
        @click="apply"
      >
        Apply best release settings
      </button>
    </div>
  </div>
</template>

<style scoped>
.c-pulse-optimizer {
  width: 100%;
  border: var(--var-border-width, 0.2rem) solid var(--color-reality);
  border-radius: var(--var-border-radius, 0.5rem);
  margin-top: 1.5rem;
  padding: 1rem;
  line-height: 1.5;
}

.c-pulse-optimizer__controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  margin: 0.8rem 0;
}

.c-pulse-optimizer__status {
  color: var(--color-bad);
  margin-top: 0.5rem;
}

.c-pulse-optimizer__button {
  margin-top: 0.8rem;
}

.c-pulse-optimizer__result {
  margin-top: 0.8rem;
}
</style>
