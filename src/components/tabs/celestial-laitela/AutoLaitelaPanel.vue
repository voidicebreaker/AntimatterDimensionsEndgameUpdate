<script>
export default {
  name: "AutoLaitelaPanel",
  data() {
    return {
      isActive: false,
      status: "",
      unavailableReason: "",
      log: [],
      isRunning: false,
      runSeconds: 0,
      dimensions: 0,
    };
  },
  methods: {
    update() {
      this.isActive = AutoLaitela.isActive;
      this.status = AutoLaitela.status;
      this.unavailableReason = AutoLaitela.unavailableReason;
      this.log = AutoLaitela.log.map(entry => entry.text);
      this.isRunning = Laitela.isRunning;
      this.runSeconds = AutoLaitela.runSeconds;
      this.dimensions = Laitela.maxAllowedDimension;
    },
    toggle() {
      if (this.isActive) AutoLaitela.stop();
      else AutoLaitela.start();
    },
  },
};
</script>

<template>
  <div class="c-auto-laitela">
    <b>Auto Lai'tela</b>
    <div>
      Repeats Lai'tela's Reality while each run destabilizes it (completes in under {{ formatInt(30) }} seconds),
      Hadronizing when it is fully destabilized. It stops once a run passes {{ formatInt(30) }} seconds.
    </div>
    <button
      class="o-primary-btn c-auto-laitela__button"
      :disabled="!isActive && Boolean(unavailableReason)"
      @click="toggle"
    >
      {{ isActive ? "Stop" : "Start" }}
    </button>
    <div
      v-if="!isActive && unavailableReason"
      class="c-auto-laitela__warning"
    >
      {{ unavailableReason }}
    </div>
    <div v-if="isActive && isRunning">
      Current run: {{ format(runSeconds, 2, 1) }}s with {{ formatInt(dimensions) }} active Dimensions
    </div>
    <div v-if="status">
      {{ status }}
    </div>
    <ul
      v-if="log.length"
      class="c-auto-laitela__log"
    >
      <li
        v-for="(entry, index) in log"
        :key="index"
      >
        {{ entry }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.c-auto-laitela {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  max-width: 60rem;
  border: var(--var-border-width, 0.2rem) solid var(--color-laitela--accent, var(--color-text));
  border-radius: var(--var-border-radius, 0.5rem);
  margin: 1rem auto;
  padding: 1rem;
}

.c-auto-laitela__button {
  min-width: 10rem;
}

.c-auto-laitela__warning {
  color: var(--color-bad);
}

.c-auto-laitela__log {
  text-align: left;
  margin: 0;
}
</style>
