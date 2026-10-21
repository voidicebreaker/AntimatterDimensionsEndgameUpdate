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
      enabled: 0,
      isEnabled: true,
      isSpeedrun: false,
      power: 5,
      scoreMultiplier: 1,
      hasOffline: false,
      raUnlocked: false,
      raChunkMultiplier: 1,
      raMemoryMultiplier: 1,
      hasRaSingularity: false,
      timeFlowMode: "on",
      isTimeFlowActive: true,
      isInLaitela: false,
      laitelaUpgradeNames: [],
      laitelaPower: 1,
      entropyCatalyst: 1,
      laitelaRewardPower: 1,
      continuumOverdrive: 1,
    };
  },
  computed: {
    upgrades: () => OverclockUpgrades.all,
    total: () => OverclockUpgrades.all.length,
    rows: () => Math.ceil(OverclockUpgrades.all.length / 5),
    powerSettings: () => [
      { power: 1, label: "Normal" },
      { power: 5, label: "Boost" },
      { power: 10, label: "Turbo" },
    ],
    timeFlowModeText() {
      switch (this.timeFlowMode) {
        case "off": return "OFF";
        case "laitela": return "OFF in Lai'tela";
        default: return "ON";
      }
    },
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
      this.enabled = OverclockUpgrades.enabledCount;
      this.isEnabled = Overclock.isEnabled;
      this.isSpeedrun = player.speedrun.isActive;
      this.power = Overclock.power;
      this.scoreMultiplier = Overclock.scoreMultiplier;
      this.hasOffline = OverclockUpgrade(3).isEffectActive;
      this.raUnlocked = Ra.isUnlocked;
      this.raChunkMultiplier = OverclockUpgrade(29).effectOrDefault(1);
      this.raMemoryMultiplier = OverclockUpgrade(30).effectOrDefault(1);
      this.hasRaSingularity = OverclockUpgrade(31).isEffectActive;
      this.timeFlowMode = Overclock.timeFlowMode;
      this.isTimeFlowActive = Overclock.isTimeFlowActive;
      this.isInLaitela = Laitela.isRunning;
      this.laitelaUpgradeNames = OverclockUpgrades.all
        .filter(u => u.kind === "laitela" && u.isEffectActive)
        .map(u => u.name);
      this.laitelaPower = Overclock.laitelaPower;
      this.entropyCatalyst = Overclock.entropyCatalyst;
      this.laitelaRewardPower = Overclock.laitelaRewardPower;
      this.continuumOverdrive = Overclock.continuumOverdrive;
    },
    cycleTimeFlowMode() {
      const modes = Overclock.timeFlowModes;
      Overclock.setTimeFlowMode(modes[(modes.indexOf(this.timeFlowMode) + 1) % modes.length]);
      this.update();
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
        :aria-pressed="String(isEnabled)"
        :disabled="isSpeedrun"
        @click="toggle"
      >
        Overclock: {{ isEnabled ? "ON" : "OFF" }}
      </button>
      <button
        v-for="setting in powerSettings"
        :key="setting.power"
        class="o-primary-btn"
        :class="{ 'c-overclock-controls__selected': power === setting.power }"
        :aria-pressed="String(power === setting.power)"
        :disabled="isSpeedrun"
        @click="setPower(setting.power)"
      >
        {{ setting.label }} {{ formatX(setting.power) }}
      </button>
      <button
        class="o-primary-btn"
        :disabled="isSpeedrun"
        @click="cycleTimeFlowMode"
      >
        Time Flow: {{ timeFlowModeText }}
      </button>
    </div>
    <div class="c-overclock-infotext">
      <span v-if="isSpeedrun">
        Overclock has no effect during a Speedrun.
      </span>
      <span v-else-if="!isEnabled">
        Overclock is off. Your upgrades are kept; speed and gain bonuses are paused.
      </span>
      <span v-else-if="!isTimeFlowActive">
        Time Flow is off{{ timeFlowMode === "laitela" ? " inside Lai'tela's Reality" : "" }}, so time runs normally.
        Every other Overclock bonus still applies.
      </span>
      <span v-else>
        Every real second, {{ secondsDisplay }} in the game.
      </span>
      <br>
      Time Flow speeds up everything at once: production, autobuyers, and every mechanic which runs on real time.
      Switch it off, or off only inside Lai'tela's Reality, to keep the stat boosts without the extra speed.
      <br>
      Shared prestige gain bonus: {{ formatX(scoreMultiplier, 2, 2) }} to IP, EP, RM, CP, CIP and CEP.
      Enabled Interest upgrades apply {{ formatPercents(0.3) }} of the bonus from {{ formatInt(5) }} times Time Flow.
      <br>
      Normal, Boost and Turbo multiply both base speed and prestige gains before your purchased upgrades.
      <br>
      <template v-if="raUnlocked">
        Ra bonuses: {{ formatX(raChunkMultiplier) }} Memory Chunk gain and
        {{ formatX(raMemoryMultiplier) }} Memory production, in addition to Time Flow.
        <br>
        <template v-if="hasRaSingularity">
          Memory Singularity adds {{ formatX(1000) }} Memory production per pet, scaling with level costs above
          level {{ formatInt(60) }}. Each pet's multiplier is shown on the Ra tab.
          <br>
        </template>
      </template>
      <template v-if="laitelaUpgradeNames.length > 0">
        <template v-if="isInLaitela">
          Lai'tela bonuses: Dimension multipliers {{ formatPow(laitelaPower, 2, 2) }},
          Entropy antimatter exponent ÷{{ formatInt(entropyCatalyst) }},
          Continuum purchases {{ formatX(continuumOverdrive) }},
          Reality rewards {{ formatPow(laitelaRewardPower) }}.
        </template>
        <template v-else>
          Lai'tela Overclocks ({{ laitelaUpgradeNames.join(", ") }}) work inside Lai'tela's Reality;
          Void Harvest's reward boost applies everywhere.
        </template>
        <br>
      </template>
      <span v-if="hasOffline">Night Shift applies {{ formatPercents(0.3) }} of the extra Time Flow speed offline.</span>
      <span v-else>Time Flow does not apply while you are offline.</span>
      Overclocks are permanent, cannot be refunded, and are kept through every kind of reset.
      <br>
      You own {{ formatInt(bought) }} of {{ formatInt(total) }} Overclocks.
      {{ formatInt(enabled) }} individually enabled. Click any purchased upgrade to toggle it.
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
