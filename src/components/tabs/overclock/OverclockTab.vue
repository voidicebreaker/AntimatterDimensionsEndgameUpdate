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
      isDisabled: false,
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
      this.isDisabled = Overclock.isDisabled;
      this.hasOffline = OverclockUpgrade(3).isBought;
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
    <div class="c-overclock-infotext">
      <span v-if="isDisabled">
        Overclock has no effect during a Speedrun.
      </span>
      <span v-else>
        Every real second, {{ secondsDisplay }} in the game.
      </span>
      <br>
      Time Flow speeds up everything at once: production, autobuyers, and every mechanic which runs on real time.
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
