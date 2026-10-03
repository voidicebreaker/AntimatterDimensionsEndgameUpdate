<script>
import CostDisplay from "@/components/CostDisplay";
import DescriptionDisplay from "@/components/DescriptionDisplay";
import EffectDisplay from "@/components/EffectDisplay";

export default {
  name: "OverclockUpgradeButton",
  components: {
    DescriptionDisplay,
    EffectDisplay,
    CostDisplay
  },
  props: {
    upgrade: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      isBought: false,
      isEnabled: false,
      isEffectActive: false,
      isAvailableForPurchase: false,
      canBeBought: false,
    };
  },
  computed: {
    config() {
      return this.upgrade.config;
    },
    classObject() {
      return {
        "c-overclock-upgrade-btn--bought": this.isBought,
        "c-overclock-upgrade-btn--disabled": this.isBought && !this.isEnabled,
        "c-overclock-upgrade-btn--unavailable": !this.isBought && this.isAvailableForPurchase && !this.canBeBought,
        "c-overclock-upgrade-btn--locked": !this.isBought && !this.isAvailableForPurchase,
      };
    },
    // Upgrades with a fixed multiplier already state it in their description
    hasDynamicEffect() {
      return this.config.formatEffect !== undefined;
    },
    showEffect() {
      return this.hasDynamicEffect && (this.isEffectActive || !this.isBought && this.config.kind === "flow");
    },
    buttonLabel() {
      return this.isBought
        ? `${this.upgrade.name}: ${this.isEnabled ? "ON" : "OFF"}`
        : `Buy ${this.upgrade.name}`;
    }
  },
  methods: {
    update() {
      const upgrade = this.upgrade;
      this.isBought = upgrade.isBought;
      this.isEnabled = upgrade.isEnabled;
      this.isEffectActive = upgrade.isEffectActive;
      this.isAvailableForPurchase = upgrade.isAvailableForPurchase;
      this.canBeBought = upgrade.canBeBought;
    },
    click() {
      if (this.isBought) this.upgrade.toggle();
      else this.upgrade.purchase();
      this.update();
    }
  }
};
</script>

<template>
  <button
    :class="classObject"
    :aria-label="buttonLabel"
    :aria-pressed="isBought ? String(isEnabled) : undefined"
    class="l-overclock-upgrade-btn c-overclock-upgrade-btn"
    @click="click"
  >
    <span class="c-overclock-upgrade-btn__name">{{ upgrade.name }}</span>
    <span>
      <DescriptionDisplay :config="config" />
      <EffectDisplay
        v-if="showEffect"
        :config="config"
        br
      />
      <template v-if="!isBought">
        <template v-if="isAvailableForPurchase">
          <CostDisplay
            :config="config"
            br
            :name="config.currencyName"
          />
        </template>
        <template v-else>
          <br>
          <span class="c-overclock-upgrade-btn__requirement">Requires: {{ config.requirement }}</span>
        </template>
      </template>
    </span>
    <span
      v-if="isBought"
      class="c-overclock-upgrade-btn__toggle"
    >
      {{ isEnabled ? "ON — click to disable" : "OFF — click to enable" }}
      <template v-if="isEnabled && !isEffectActive">
        (master paused)
      </template>
    </span>
  </button>
</template>

<style scoped>
.l-overclock-upgrade-btn {
  display: flex;
  flex-direction: column;
  width: 20.5rem;
  min-height: 13rem;
  justify-content: center;
  align-items: center;
  margin: 0.8rem;
  padding: 0.5rem;
}

.c-overclock-upgrade-btn {
  text-align: center;
  font-family: Typewriter, serif;
  font-size: 1rem;
  color: var(--color-text);
  background-color: var(--color-base);
  border: var(--var-border-width, 0.2rem) solid var(--color-overclock);
  border-radius: var(--var-border-radius, 0.5rem);
  transition-duration: 0.15s;
  cursor: pointer;
}

.c-overclock-upgrade-btn:hover {
  color: black;
  background-color: var(--color-overclock-light);
}

.c-overclock-upgrade-btn__name {
  font-size: 1.2rem;
  font-weight: bold;
  color: var(--color-overclock);
  margin-bottom: 0.4rem;
}

.c-overclock-upgrade-btn:hover .c-overclock-upgrade-btn__name {
  color: var(--color-overclock-dark);
}

.c-overclock-upgrade-btn__requirement {
  font-weight: bold;
}

.c-overclock-upgrade-btn__toggle {
  font-weight: bold;
  margin-top: 0.5rem;
}

.c-overclock-upgrade-btn--bought,
.c-overclock-upgrade-btn--bought:hover {
  color: white;
  background-color: var(--color-overclock-dark);
  border-color: var(--color-overclock);
  cursor: pointer;
}

.c-overclock-upgrade-btn--bought .c-overclock-upgrade-btn__name,
.c-overclock-upgrade-btn--bought:hover .c-overclock-upgrade-btn__name {
  color: var(--color-overclock-light);
}

.c-overclock-upgrade-btn--disabled,
.c-overclock-upgrade-btn--disabled:hover {
  color: var(--color-text);
  background-color: var(--color-base);
  border-style: dashed;
}

.c-overclock-upgrade-btn--unavailable,
.c-overclock-upgrade-btn--unavailable:hover {
  color: var(--color-text);
  background-color: var(--color-base);
  opacity: 0.75;
  cursor: default;
}

.c-overclock-upgrade-btn--locked,
.c-overclock-upgrade-btn--locked:hover {
  color: var(--color-text);
  background-color: var(--color-base);
  border-style: dashed;
  opacity: 0.65;
  cursor: default;
}

.c-overclock-upgrade-btn--unavailable:hover .c-overclock-upgrade-btn__name,
.c-overclock-upgrade-btn--locked:hover .c-overclock-upgrade-btn__name {
  color: var(--color-overclock);
}
</style>
