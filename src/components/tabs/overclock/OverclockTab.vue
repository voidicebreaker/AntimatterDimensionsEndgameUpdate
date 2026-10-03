<script>
import OverclockUpgradeButton from "./OverclockUpgradeButton";

export default {
  name: "OverclockTab",
  components: {
    OverclockUpgradeButton
  },
  data() {
    return {
      timeFlow: 1,
      bought: 0,
      isEnabled: true,
      isSpeedrun: false,
      power: 5,
      scoreMultiplier: 1,
      hasOffline: false,
    };
  },
  computed: {
    upgrades: () => OverclockUpgrades.all,
    total: () => OverclockUpgrades.all.length,
    rows: () => Math.ceil(OverclockUpgrades.all.length / 5),
    flowDisplay() {
      return formatX(this.timeFlow, 2, 2);
    },
    secondsDisplay() {
      return this.timeFlow === 1
        ? `${formatInt(1)} second passes`
        : `${format(this.timeFlow, 2, 2)} seconds pass`;
    }
  },
  methods: {
    update() {
      this.timeFlow = Overclock.timeFlow;
      this.bought = OverclockUpgrades.boughtCount;
      this.isEnabled = Overclock.isEnabled;
      this.isSpeedrun = player.speedrun.isActive;
      this.power = Overclock.power;
      this.scoreMultiplier = Overclock.scoreMultiplier;
      this.hasOffline = OverclockUpgrade(3).isBought && !Overclock.isDisabled;
    },
    toggle() {
      Overclock.setEnabled(!this.isEnabled);
      this.update();
    },
    setPower(power) {
      Overclock.setPower(power);
      this.update();
    },
    rowUpgrades(row) {
      return this.upgrades.slice((row - 1) * 5, row * 5);
    }
  }
};
</script>

<template>
  <div class="l-overclock-tab">
    <div class="c-overclock-header">
      Time Flow
      <span class="c-overclock-header__amount">{{ flowDisplay }}</span>
    </div>
    <div class="c-overclock-controls">
      <button
        class="o-primary-btn"
        :aria-pressed="isEnabled"
        :disabled="isSpeedrun"
        @click="toggle"
      >
        Overclock: {{ isEnabled ? "ON" : "OFF" }}
      </button>
      <button
        v-for="setting in [5, 10]"
        :key="setting"
        class="o-primary-btn"
        :class="{ 'c-overclock-controls__selected': power === setting }"
        :aria-pressed="power === setting"
        :disabled="isSpeedrun"
        @click="setPower(setting)"
      >
        {{ setting === 5 ? "Boost" : "Turbo" }} {{ formatX(setting) }}
      </button>
    </div>
    <div class="c-overclock-infotext">
      <span v-if="isSpeedrun">
        Overclock has no effect during a Speedrun.
      </span>
      <span v-else-if="!isEnabled">
        Overclock is off. Your upgrades are kept; speed and gain bonuses are paused.
      </span>
      <span v-else>
        Every real second, {{ secondsDisplay }} in the game.
      </span>
      <br>
      Time Flow speeds up everything at once: production, autobuyers, and every mechanic which runs on real time.
      <br>
      Shared prestige gain bonus: {{ formatX(scoreMultiplier, 2, 2) }} to IP, EP, RM, CP, CIP and CEP.
      Interest upgrades multiply their matching gains by another {{ formatInt(5) }} times Time Flow.
      <br>
      Boost and Turbo multiply both base speed and prestige gains before your purchased upgrades.
      <br>
      It {{ hasOffline ? "also applies" : "does not apply" }} while you are offline.
      Overclocks are permanent, cannot be refunded, and are kept through every kind of reset.
      <br>
      You own {{ formatInt(bought) }} of {{ formatInt(total) }} Overclocks.
    </div>
    <div
      v-for="row in rows"
      :key="row"
      class="l-overclock-grid__row"
    >
      <OverclockUpgradeButton
        v-for="upgrade in rowUpgrades(row)"
        :key="upgrade.id"
        :upgrade="upgrade"
      />
    </div>
  </div>
</template>

<style scoped>
.l-overclock-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.c-overclock-header {
  font-size: 2rem;
  font-weight: bold;
  color: var(--color-text);
  margin-top: 0.5rem;
}

.c-overclock-header__amount {
  font-size: 3rem;
  color: var(--color-overclock);
  margin-left: 0.5rem;
}

.c-overclock-controls {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.8rem;
  margin: 1rem 0;
}

.c-overclock-controls__selected {
  color: white;
  background-color: var(--color-overclock-dark);
}

.c-overclock-infotext {
  color: var(--color-text);
  margin: 0.5rem 0 1rem;
  line-height: 1.5;
}

.l-overclock-grid__row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
}
</style>
