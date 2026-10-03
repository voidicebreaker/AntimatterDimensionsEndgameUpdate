import { BitPurchasableMechanicState } from "./game-mechanics";

class OverclockUpgradeState extends BitPurchasableMechanicState {
  get name() {
    return this.config.name;
  }

  get kind() {
    return this.config.kind;
  }

  get currency() {
    return this.config.currency();
  }

  get bitIndex() {
    return this.id;
  }

  get bits() {
    return player.overclock.upgradeBits;
  }

  set bits(value) {
    player.overclock.upgradeBits = value;
  }

  get isAvailableForPurchase() {
    return this.config.checkRequirement();
  }

  onPurchased() {
    GameCache.totalIPMult.invalidate();
    GameCache.totalCIPMult.invalidate();
    GameUI.notify.success(`Overclock installed: ${this.name}`);
  }
}

OverclockUpgradeState.index = mapGameData(
  GameDatabase.overclock.upgrades,
  config => new OverclockUpgradeState(config)
);

/**
 * @param {number} id
 * @return {OverclockUpgradeState}
 */
export const OverclockUpgrade = id => OverclockUpgradeState.index[id];

export const OverclockUpgrades = {
  /**
   * @type {OverclockUpgradeState[]}
   */
  all: OverclockUpgradeState.index.compact(),
  get flow() {
    return this.all.filter(u => u.kind === "flow");
  },
  get boughtCount() {
    return this.all.countWhere(u => u.isBought);
  },
};

export const Overclock = {
  // A single live tick is split into at most this many smaller ones, so that a high Time Flow doesn't turn the game
  // into a slideshow of huge ticks (which would starve autobuyers and make short timed goals impossible)
  maxSubticks: 20,

  // Speedruns are timed in real time, so Overclock would just be a cheat there
  get isDisabled() {
    return !this.isEnabled || player.speedrun.isActive;
  },

  get isEnabled() {
    return player.overclock.enabled !== false;
  },

  get power() {
    return player.overclock.power === 10 ? 10 : 5;
  },

  setEnabled(enabled) {
    player.overclock.enabled = Boolean(enabled);
    this.invalidateMultipliers();
  },

  setPower(power) {
    if (power !== 5 && power !== 10) return;
    player.overclock.power = power;
    this.invalidateMultipliers();
  },

  invalidateMultipliers() {
    GameCache.totalIPMult.invalidate();
    GameCache.totalCIPMult.invalidate();
  },

  get isInChallenge() {
    return Player.isInAnyChallenge || player.dilation.active || isInCelestialReality() ||
      player.endgame.overcharge.isRunning || player.compression.active;
  },

  /**
   * How many seconds pass in the game for every real second. This multiplies real time itself, which means it speeds
   * up every part of the game equally, including the parts which normally ignore game speed.
   * @return {number}
   */
  get timeFlow() {
    if (this.isDisabled) return 1;
    let flow = this.power;
    for (const upgrade of OverclockUpgrades.all) {
      if (upgrade.kind === "flow" && upgrade.isBought) flow *= upgrade.effectValue;
    }
    return flow;
  },

  // Time Flow as applied to offline time and to catching up after the device was asleep
  get offlineFlow() {
    return OverclockUpgrade(3).isBought ? this.timeFlow : 1;
  },

  // The selected power and Dividend upgrades boost all prestige gains immediately.
  get scoreMultiplier() {
    if (this.isDisabled) return 1;
    let mult = this.power;
    for (const upgrade of OverclockUpgrades.all) {
      if (upgrade.kind === "gain" && upgrade.isBought) mult *= upgrade.effectValue;
    }
    return mult;
  },

  get interestMultiplier() {
    return this.isDisabled ? 1 : 5 * this.timeFlow;
  },

  // Interest upgrades stack with the shared point bonus.
  get ipMultiplier() {
    return this.scoreMultiplier * (OverclockUpgrade(5).isBought ? this.interestMultiplier : 1);
  },

  get epMultiplier() {
    return this.scoreMultiplier * (OverclockUpgrade(9).isBought ? this.interestMultiplier : 1);
  },

  get rmMultiplier() {
    return this.scoreMultiplier * (OverclockUpgrade(12).isBought ? this.interestMultiplier : 1);
  },

  get celestialMultiplier() {
    return this.scoreMultiplier * (OverclockUpgrade(18).isBought ? this.interestMultiplier : 1);
  },

  // Achievements and Celestials get taken away by some resets, so the upgrades which count them use the highest
  // amount ever held instead of the current amount
  updateRecords() {
    const data = player.overclock;
    const achievements = Achievements.all.countWhere(a => a.isUnlocked);
    if (achievements > data.maxAchievements) data.maxAchievements = achievements;
    const celestials = Tab.celestials.subtabs.countWhere(s => s.key !== "celestial-navigation" && s.isUnlocked);
    if (celestials > data.maxCelestials) data.maxCelestials = celestials;
  },
};
