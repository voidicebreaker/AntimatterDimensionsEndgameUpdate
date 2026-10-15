<script>
export default {
  name: "ECSolverTab",
  data() {
    return {
      unavailableReason: "",
      settings: { ...ECSolver.settings, groups: { ...ECSolver.settings.groups } },
      challenges: [],
      defaultLabel: "",
      challengeId: 0,
      goal: new Decimal(0),
      isAlphaForcedBulk: false,
      canBulk: false,
      running: false,
      phase: "",
      done: 0,
      round: 0,
      elapsed: 0,
      parallel: false,
      workersInUse: 0,
      maxWorkers: SolverPool.maxSize,
      canUseWorkers: SolverPool.isSupported,
      note: "",
      error: "",
      lastRun: null,
      showAll: false,
      pollInterval: null,
    };
  },
  computed: {
    groupOptions() {
      return [
        { key: "tree", name: "Time Study paths" },
        { key: "crunch", name: "Crunch timing" },
        { key: "replicanti", name: "Replicanti Galaxies" },
        { key: "limits", name: "Boost/Galaxy limits" },
      ];
    },
    recommended() {
      return this.lastRun?.recommended ?? null;
    },
    visibleEntries() {
      const entries = this.lastRun?.entries ?? [];
      return this.showAll ? entries : entries.slice(0, 15);
    },
    elapsedText() {
      return TimeSpan.fromSeconds(this.elapsed).toStringShort();
    },
  },
  watch: {
    settings: {
      deep: true,
      handler(value) {
        Object.assign(ECSolver.settings, value, { groups: { ...value.groups } });
      }
    }
  },
  beforeDestroy() {
    clearInterval(this.pollInterval);
  },
  methods: {
    update() {
      this.unavailableReason = ECSolver.unavailableReason;
      const fallback = ECSolver.defaultChallenge;
      this.defaultLabel = `Automatic (EC${fallback.id})`;
      this.challenges = EternityChallenges.all.map(ec => ({ id: ec.id, completions: ec.completions }));
      this.challengeId = ECSolver.challengeId;
      this.goal = ECSolver.goal();
      this.isAlphaForcedBulk = ECSolver.isAlphaForcedBulk;
      this.canBulk = ECSolver.canBulk;
      const status = ECSolver.status;
      this.running = status.running;
      this.phase = status.phase;
      this.done = status.done;
      this.round = status.round;
      this.elapsed = status.running ? (Date.now() - status.startedAt) / 1000 : 0;
      this.parallel = status.parallel;
      this.workersInUse = status.workers;
      this.note = status.note;
      this.error = status.error;
      this.lastRun = status.lastRun;
    },
    solve() {
      // The game UI does not update while trials run, so poll for progress until the solve finishes
      clearInterval(this.pollInterval);
      this.pollInterval = setInterval(() => this.update(), 250);
      ECSolver.solve().finally(() => {
        clearInterval(this.pollInterval);
        this.update();
      });
    },
    cancel() {
      ECSolver.cancel();
    },
    copyTree(text) {
      copyToClipboard(text);
      GameUI.notify.info("Time Study tree copied to clipboard");
    },
    formatLog(log) {
      return format(Decimal.pow10(log), 2, 2);
    },
    formatTime(seconds) {
      return TimeSpan.fromSeconds(seconds).toStringShort();
    },
    outcome(entry) {
      if (entry.failed) return entry.reason;
      if (entry.reachedAt !== null) return `Reaches the goal in ${this.formatTime(entry.reachedAt)}`;
      const best = `Reaches ${this.formatLog(entry.finalLog)} of ${this.formatLog(this.lastRun.goalLog)} IP`;
      if (entry.eta === null) return `${best}; growth has stalled`;
      return `${best}; about ${this.formatTime(entry.eta)} more at its late growth rate (rough)`;
    },
    treeChoices(entry) {
      return entry.choices.filter(c => c.group === "tree").map(c => c.label).join(", ");
    },
    settingChoices(entry) {
      return entry.choices.filter(c => c.group !== "tree");
    },
  },
};
</script>

<template>
  <div class="c-ec-solver">
    <div class="c-ec-solver__intro">
      Tries Time Study trees and autobuyer settings for an Eternity Challenge by running the real game on a copy of
      your save, starting each try from a fresh Eternity. It only gives advice: your save is restored afterwards and
      nothing is bought or changed for you.
    </div>

    <div class="c-ec-solver__controls">
      <label>
        Challenge
        <select
          v-model.number="settings.ec"
          class="o-primary-btn"
          :disabled="running"
        >
          <option :value="0">{{ defaultLabel }}</option>
          <option
            v-for="ec in challenges"
            :key="ec.id"
            :value="ec.id"
          >
            EC{{ ec.id }} ({{ formatInt(ec.completions) }}/{{ formatInt(5) }})
          </option>
        </select>
      </label>
      <label v-if="!isAlphaForcedBulk">
        Target completions
        <input
          v-model.number="settings.target"
          type="number"
          min="1"
          max="5"
          class="c-ec-solver__input"
          :disabled="running"
        >
      </label>
      <label>
        Simulate
        <input
          v-model.number="settings.seconds"
          type="number"
          min="1"
          class="c-ec-solver__input"
          :disabled="running"
        >
        real seconds
      </label>
      <label>
        Search at
        <input
          v-model.number="settings.screenTicks"
          type="number"
          min="1"
          class="c-ec-solver__input"
          :disabled="running"
        >
        ticks, confirm best {{ formatInt(settings.confirmCount) }} at
        <input
          v-model.number="settings.confirmTicks"
          type="number"
          min="1"
          class="c-ec-solver__input"
          :disabled="running"
        >
        ticks
      </label>
      <label>
        <input
          v-model="settings.useTimeFlow"
          type="checkbox"
          :disabled="running"
        >
        Include Overclock time flow
      </label>
      <label v-if="canUseWorkers">
        CPU workers
        <input
          v-model.number="settings.workers"
          type="number"
          min="0"
          :max="maxWorkers"
          class="c-ec-solver__input"
          :disabled="running"
        >
        (0 runs on this page and pauses the game)
      </label>
    </div>

    <div class="c-ec-solver__controls">
      Vary:
      <label
        v-for="group in groupOptions"
        :key="group.key"
      >
        <input
          v-model="settings.groups[group.key]"
          type="checkbox"
          :disabled="running"
        >
        {{ group.name }}
      </label>
    </div>

    <div>
      Goal for EC{{ challengeId }}: {{ format(goal, 2, 2) }} Infinity Points in one run.
      <span v-if="isAlphaForcedBulk">Alpha requires all {{ formatInt(5) }} completions at once.</span>
      <span v-else-if="!canBulk">Without bulk completion, this is the next single completion.</span>
    </div>
    <div
      v-if="unavailableReason"
      class="c-ec-solver__warning"
    >
      {{ unavailableReason }}
    </div>
    <div
      v-if="error"
      class="c-ec-solver__warning"
    >
      {{ error }}
    </div>
    <div
      v-if="note"
      class="c-ec-solver__warning"
    >
      {{ note }}
    </div>

    <div
      v-if="running && parallel"
      class="c-ec-solver__progress"
    >
      <b>EC Solver: {{ phase }}<span v-if="round"> (round {{ formatInt(round) }})</span></b>
      on {{ formatInt(workersInUse) }} workers. {{ formatInt(done) }} plans tried in {{ elapsedText }}.
      You can keep playing; the solver works on a copy of your save.
      <button
        class="o-primary-btn c-ec-solver__button"
        @click="cancel"
      >
        Cancel
      </button>
    </div>

    <button
      class="o-primary-btn c-ec-solver__button"
      :disabled="Boolean(unavailableReason) || running"
      @click="solve"
    >
      Solve
    </button>

    <div
      v-if="recommended"
      class="c-ec-solver__result"
    >
      <b>Recommended plan for EC{{ lastRun.settings.ec }}</b>
      <span v-if="lastRun.cancelled">(cancelled; partial search)</span>
      <div>{{ outcome(recommended) }}, simulating {{ formatTime(lastRun.settings.seconds) }} of real time.</div>
      <div class="c-ec-solver__tree">
        <code>{{ recommended.exportString }}</code>
        <button
          class="o-primary-btn"
          @click="copyTree(recommended.exportString)"
        >
          Copy tree
        </button>
      </div>
      <div>Studies: {{ treeChoices(recommended) }}</div>
      <div>Then set:</div>
      <ul class="c-ec-solver__settings">
        <li
          v-for="choice in settingChoices(recommended)"
          :key="choice.key"
        >
          {{ choice.name }}: {{ choice.label }}
        </li>
        <li>Eternity autobuyer: Off; Infinity, Time Dimension and Replicanti upgrade autobuyers: On</li>
      </ul>
      <div class="c-ec-solver__note">
        Start from a fresh Eternity, import the tree, enter the challenge right away and let the autobuyers run.
      </div>
    </div>

    <div
      v-if="lastRun && lastRun.entries.length"
      class="c-ec-solver__table-wrapper"
    >
      <table class="c-ec-solver__table">
        <tr>
          <th>#</th>
          <th>Result</th>
          <th>Studies</th>
          <th>Crunch</th>
          <th>Replicanti Galaxies</th>
          <th>Boosts / Galaxies</th>
          <th>Ticks</th>
        </tr>
        <tr
          v-for="(entry, index) in visibleEntries"
          :key="`${entry.key}-${entry.ticks}`"
        >
          <td>{{ formatInt(index + 1) }}</td>
          <td>{{ outcome(entry) }}</td>
          <td class="c-ec-solver__studies">
            {{ treeChoices(entry) }}
          </td>
          <td
            v-for="choice in settingChoices(entry)"
            :key="choice.key"
          >
            {{ choice.label }}
          </td>
          <td>{{ formatInt(entry.ticks) }}</td>
        </tr>
      </table>
      <button
        v-if="lastRun.entries.length > 15"
        class="o-primary-btn c-ec-solver__button"
        @click="showAll = !showAll"
      >
        {{ showAll ? "Show top 15" : `Show all ${formatInt(lastRun.entries.length)}` }}
      </button>
    </div>

    <div
      v-if="running && !parallel"
      class="c-ec-solver__overlay"
    >
      <div class="c-ec-solver__overlay-box">
        <b>EC Solver: {{ phase }}<span v-if="round"> (round {{ formatInt(round) }})</span></b>
        <div>{{ formatInt(done) }} plans tried in {{ elapsedText }}</div>
        <div>Your save is restored afterwards, and offline progress covers the time spent solving.</div>
        <button
          class="o-primary-btn c-ec-solver__button"
          @click="cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.c-ec-solver {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.8rem;
  width: 100%;
  line-height: 1.5;
}

.c-ec-solver__intro {
  max-width: 80rem;
}

.c-ec-solver__controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 1rem;
}

.c-ec-solver__input {
  width: 7rem;
}

.c-ec-solver__warning {
  color: var(--color-bad);
}

.c-ec-solver__result {
  max-width: 90rem;
  border: var(--var-border-width, 0.2rem) solid var(--color-eternity);
  border-radius: var(--var-border-radius, 0.5rem);
  padding: 1rem;
}

.c-ec-solver__tree {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  margin: 0.5rem 0;
}

.c-ec-solver__tree code {
  word-break: break-all;
}

.c-ec-solver__settings {
  text-align: left;
  margin: 0.3rem auto;
  width: fit-content;
}

.c-ec-solver__note {
  opacity: 0.8;
}

.c-ec-solver__table-wrapper {
  max-width: 100%;
  overflow-x: auto;
}

.c-ec-solver__table {
  border-collapse: collapse;
  margin: 0.5rem auto;
}

.c-ec-solver__table th,
.c-ec-solver__table td {
  border: 0.1rem solid var(--color-eternity);
  padding: 0.2rem 0.6rem;
}

.c-ec-solver__studies {
  max-width: 30rem;
}

.c-ec-solver__overlay {
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

.c-ec-solver__overlay-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  max-width: 50rem;
  border: var(--var-border-width, 0.2rem) solid var(--color-eternity);
  border-radius: var(--var-border-radius, 0.5rem);
  padding: 1.5rem;
  background: var(--color-base);
}

.c-ec-solver__progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  border: var(--var-border-width, 0.2rem) solid var(--color-eternity);
  border-radius: var(--var-border-radius, 0.5rem);
  padding: 1rem;
}

.c-ec-solver__button {
  margin-top: 0.5rem;
}
</style>
