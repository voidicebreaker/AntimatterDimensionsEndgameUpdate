<script>
export default {
  name: "ECSchedulerPanel",
  data() {
    return {
      unlocked: false,
      running: false,
      status: "",
      mode: "balanced",
      current: 0,
      rows: [],
      log: [],
      diagnostics: [],
      ec8Chance: 9,
      ec8Interval: 10,
      blocked: ""
    };
  },
  methods: {
    update() {
      this.unlocked = ECScheduler.isUnlocked;
      if (!this.unlocked) return;
      const data = ECScheduler.data;
      this.running = data.running;
      this.status = data.status;
      this.current = data.current;
      this.mode = data.mode;
      this.ec8Chance = data.ec8Chance;
      this.ec8Interval = data.ec8Interval;
      this.blocked = ECScheduler.unavailableReason;
      this.rows = EternityChallenges.all.map(ec => ({
        id: ec.id,
        completions: ec.completions,
        enabled: data.enabled[ec.id - 1],
        target: data.targets[ec.id - 1],
        note: data.notes[ec.id - 1],
        tree: data.trees[ec.id - 1]
      }));
      this.log = [...data.log];
      this.diagnostics = ECScheduler.diagnostics;
    },
    start() {
      ECScheduler.start();
      this.update();
    },
    pause() {
      ECScheduler.pause();
      this.update();
    },
    stop() {
      ECScheduler.stop();
      this.update();
    },
    toggle(id, event) { ECScheduler.setEnabled(id, event.target.checked); },
    target(id, event) { ECScheduler.setTarget(id, event.target.value); },
    setMode(event) { ECScheduler.data.mode = event.target.value; },
    setTree(id, event) {
      ECScheduler.setTree(id, event.target.value);
      event.target.value = ECScheduler.data.trees[id - 1];
    },
    setEC8(key, event) {
      const other = key === "ec8Chance" ? "ec8Interval" : "ec8Chance";
      ECScheduler.data[key] = Math.max(0, Math.min(40 - ECScheduler.data[other],
        Math.floor(Number(event.target.value) || 0)));
      event.target.value = ECScheduler.data[key];
      if (this.running) ECScheduler.pause("EC8 allocation changed. Resume to use the new purchase plan.");
    },
    selectAll(enabled) {
      for (let id = 1; id <= 12; id++) ECScheduler.setEnabled(id, enabled);
    }
  }
};
</script>

<template>
  <section
    v-if="unlocked"
    class="c-ec-scheduler"
    aria-label="Eternity Challenge scheduler"
  >
    <h2>EC Scheduler</h2>
    <p>Run selected Eternity Challenges, farm prerequisites, and retry when your build improves.</p>
    <div class="c-ec-scheduler__controls">
      <button
        v-if="!running"
        class="o-primary-btn"
        :disabled="Boolean(blocked)"
        @click="start"
      >
        Start / Resume
      </button>
      <button
        v-else
        class="o-primary-btn"
        @click="pause"
      >
        Pause
      </button>
      <button
        class="o-primary-btn"
        @click="stop"
      >
        Stop
      </button>
      <label>
        Pace
        <select
          :value="mode"
          @change="setMode"
        >
          <option value="balanced">Balanced — longer trials</option>
          <option value="fast">Fast — short trials</option>
        </select>
      </label>
    </div>
    <p
      class="c-ec-scheduler__status"
      role="status"
      aria-live="polite"
    >
      {{ running ? "Running: " : "" }}{{ status }}
    </p>
    <p v-if="blocked">
      {{ blocked }}
    </p>
    <div
      v-if="diagnostics.length"
      aria-label="Scheduler diagnostics"
    >
      <p
        v-for="line in diagnostics"
        :key="line"
      >
        {{ line }}
      </p>
    </div>
    <p class="c-ec-scheduler__hint">
      Handles study purchases, respecs, and Eternities. While running, the Automator and prestige autobuyers
      yield control. Pause or Stop releases them and keeps your current challenge.
      Overclock settings stay under your control. Saved sessions load paused.
      Targets are minimums; the bulk-completion perk may award extra tiers.
      Use "ec scheduler run" in an Automator script to run this automatically each Reality.
      An Automator-owned session pauses its script if stopped or interrupted.
    </p>
    <div class="c-ec-scheduler__controls">
      <button
        class="o-primary-btn"
        @click="selectAll(true)"
      >
        Select all
      </button>
      <button
        class="o-primary-btn"
        @click="selectAll(false)"
      >
        Select none
      </button>
    </div>
    <div class="c-ec-scheduler__grid">
      <div
        v-for="row in rows"
        :key="row.id"
        class="c-ec-scheduler__ec"
        :class="{ 'c-ec-scheduler__ec--current': running && current === row.id }"
      >
        <label>
          <input
            type="checkbox"
            :checked="row.enabled"
            :aria-label="`Include EC${row.id}`"
            @change="toggle(row.id, $event)"
          >
          <b>EC{{ row.id }}</b> · {{ row.completions }}/5
        </label>
        <label>
          Target
          <input
            type="number"
            min="1"
            max="5"
            step="1"
            :value="row.target"
            :aria-label="`EC${row.id} target completions`"
            @change="target(row.id, $event)"
          >
        </label>
        <span class="c-ec-scheduler__note">{{ row.note }}</span>
      </div>
    </div>
    <details class="c-ec-scheduler__details">
      <summary>Study routes and EC8 purchases</summary>
      <p>Blank routes use the built-in strategies. Custom routes replace the full normal study list for that EC.</p>
      <label
        v-for="row in rows"
        :key="row.id"
        class="c-ec-scheduler__route"
      >
        EC{{ row.id }}
        <input
          type="text"
          :value="row.tree"
          :aria-label="`EC${row.id} study route`"
          placeholder="Automatic"
          spellcheck="false"
          @change="setTree(row.id, $event)"
        >
      </label>
      <p>EC8 seeds the first Infinity Dimension and reserves the remaining ID purchases for the eighth.</p>
      <div class="c-ec-scheduler__controls">
        <label>
          Replicanti chance purchases
          <input
            type="number"
            min="0"
            max="40"
            :value="ec8Chance"
            @change="setEC8('ec8Chance', $event)"
          >
        </label>
        <label>
          Replicanti interval purchases
          <input
            type="number"
            min="0"
            max="40"
            :value="ec8Interval"
            @change="setEC8('ec8Interval', $event)"
          >
        </label>
        <span>Remaining purchases go to the Galaxy cap.</span>
      </div>
    </details>
    <details class="c-ec-scheduler__details">
      <summary>Recent activity</summary>
      <ol>
        <li
          v-for="(entry, index) in log"
          :key="`${entry.time}-${index}`"
        >
          {{ entry.message }}
        </li>
      </ol>
    </details>
  </section>
</template>

<style scoped>
.c-ec-scheduler {
  width: min(100%, 100rem);
  text-align: left;
  color: var(--color-text);
  background: var(--color-base);
  border: 0.15rem solid var(--color-eternity);
  border-radius: var(--var-border-radius, 0.5rem);
  margin: 1.5rem auto;
  padding: 1.5rem;
}

.c-ec-scheduler p { margin: 0.8rem 0; }
.c-ec-scheduler h2 { margin: 0 0 0.5rem; }
.c-ec-scheduler input,
.c-ec-scheduler select { font: inherit; }
.c-ec-scheduler input[type="number"] { width: 5rem; margin-left: 0.4rem; }
.c-ec-scheduler__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;

  gap: 0.8rem;
}
.c-ec-scheduler__status { min-height: 3rem; font-weight: bold; }
.c-ec-scheduler__hint { font-size: 1.1rem; }
.c-ec-scheduler__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(21rem, 1fr));
  margin-top: 1rem;

  gap: 0.7rem;
}
.c-ec-scheduler__ec {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  border: 0.1rem solid var(--color-text);
  border-radius: 0.4rem;
  padding: 0.8rem;

  gap: 0.5rem;
}
.c-ec-scheduler__ec--current { outline: 0.2rem solid var(--color-eternity); }
.c-ec-scheduler__note { width: 100%; min-height: 1.3rem; font-size: 1rem; }
.c-ec-scheduler__details { margin-top: 1rem; }
.c-ec-scheduler__details summary { font-weight: bold; padding: 0.5rem 0; cursor: pointer; }
.c-ec-scheduler__details ol { padding-left: 2rem; }
.c-ec-scheduler__route {
  display: flex;
  align-items: center;
  margin: 0.5rem 0;

  gap: 1rem;
}
.c-ec-scheduler__route input { flex: 1; min-width: 0; }
</style>
