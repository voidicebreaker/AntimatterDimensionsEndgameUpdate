import { BitPurchasableMechanicState } from "./game-mechanics";
import { scaleOverclockMultiplier } from "./overclock-balance";

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

  // Shifts in JS wrap at 32, so id 32 lives in bit 0 of the first field (no upgrade has id 0) and every later id
  // continues in a second field
  get usesHighBits() {
    return this.id > 32;
  }

  get bitIndex() {
    return this.usesHighBits ? this.id - 32 : this.id % 32;
  }

  get bits() {
    return this.usesHighBits ? player.overclock.upgradeBitsHigh : player.overclock.upgradeBits;
  }

  set bits(value) {
    if (this.usesHighBits) player.overclock.upgradeBitsHigh = value;
    else player.overclock.upgradeBits = value;
  }

  get disabledBits() {
    return this.usesHighBits ? player.overclock.disabledUpgradeBitsHigh : player.overclock.disabledUpgradeBits;
  }

  set disabledBits(value) {
    if (this.usesHighBits) player.overclock.disabledUpgradeBitsHigh = value;
    else player.overclock.disabledUpgradeBits = value;
  }

  get isAvailableForPurchase() {
    return this.config.checkRequirement();
  }

  get isEnabled() {
    return this.isBought && (this.disabledBits & (1 << this.bitIndex)) === 0;
  }

  get isEffectActive() {
    return this.isEnabled && !Overclock.isDisabled;
  }

  setEnabled(enabled) {
    if (!this.isBought) return false;
    if (enabled) this.disabledBits &= ~(1 << this.bitIndex);
    else this.disabledBits |= (1 << this.bitIndex);
    Overclock.invalidateMultipliers();
    GameUI.update();
    return true;
  }

  toggle() {
    return this.setEnabled(!this.isEnabled);
  }

  onPurchased() {
    Overclock.invalidateMultipliers();
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
  get enabledCount() {
    return this.all.countWhere(u => u.isEnabled);
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

  powers: [1, 5, 10],

  get power() {
    return this.powers.includes(player.overclock.power) ? player.overclock.power : 5;
  },

  setEnabled(enabled) {
    player.overclock.enabled = Boolean(enabled);
    this.invalidateMultipliers();
  },

  setPower(power) {
    if (!this.powers.includes(power)) return;
    player.overclock.power = power;
    this.invalidateMultipliers();
  },

  // Time Flow can be switched off on its own, which keeps every stat boost. "laitela" switches it off only inside
  // Lai'tela's Reality, where faster time just shortens the destabilization window.
  timeFlowModes: ["on", "laitela", "off"],

  get timeFlowMode() {
    return this.timeFlowModes.includes(player.overclock.timeFlowMode) ? player.overclock.timeFlowMode : "on";
  },

  setTimeFlowMode(mode) {
    if (!this.timeFlowModes.includes(mode)) return;
    player.overclock.timeFlowMode = mode;
    this.invalidateMultipliers();
  },

  get isTimeFlowActive() {
    const mode = this.timeFlowMode;
    return mode === "on" || (mode === "laitela" && !Laitela.isRunning);
  },

  invalidateMultipliers() {
    Enslaved.pulseTickDurationMs = 0;
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
    if (this.isDisabled || !this.isTimeFlowActive) return 1;
    let flow = this.power;
    for (const upgrade of OverclockUpgrades.all) {
      if (upgrade.kind === "flow" && upgrade.isEffectActive) flow *= upgrade.effectValue;
    }
    return flow;
  },

  // The Time Flow which a run of Lai'tela's Reality will get, even when asked from outside of it
  get laitelaTimeFlow() {
    return this.timeFlowMode === "on" ? this.timeFlow : 1;
  },

  // Time Flow as applied to offline time and to catching up after the device was asleep
  get offlineFlow() {
    return OverclockUpgrade(3).isEffectActive ? scaleOverclockMultiplier(this.timeFlow) : 1;
  },

  // The selected power and Dividend upgrades boost all prestige gains immediately.
  get scoreMultiplier() {
    if (this.isDisabled) return 1;
    let mult = this.power;
    for (const upgrade of OverclockUpgrades.all) {
      if (upgrade.kind === "gain" && upgrade.isEffectActive) mult *= upgrade.effectValue;
    }
    return mult;
  },

  get interestMultiplier() {
    return this.isDisabled ? 1 : scaleOverclockMultiplier(5 * this.timeFlow);
  },

  // Interest upgrades stack with the shared point bonus.
  get ipMultiplier() {
    return this.scoreMultiplier * (OverclockUpgrade(5).isEffectActive ? this.interestMultiplier : 1);
  },

  get epMultiplier() {
    return this.scoreMultiplier * (OverclockUpgrade(9).isEffectActive ? this.interestMultiplier : 1);
  },

  get rmMultiplier() {
    return this.scoreMultiplier * (OverclockUpgrade(12).isEffectActive ? this.interestMultiplier : 1);
  },

  get celestialMultiplier() {
    return this.scoreMultiplier * (OverclockUpgrade(18).isEffectActive ? this.interestMultiplier : 1);
  },

  isActiveInLaitela(id) {
    return OverclockUpgrade(id).isEffectActive && Laitela.isRunning;
  },

  get isLaitelaReactorActive() {
    return this.isActiveInLaitela(32);
  },

  // Dark Reactor's power to Dimension multipliers grows as Lai'tela takes Dimensions away
  get laitelaPower() {
    return this.isLaitelaReactorActive ? 1.5 + 0.25 * Laitela.difficultyTier : 1;
  },

  // Entropy Catalyst divides the antimatter exponent which Entropy and destabilization are measured against
  get entropyCatalyst() {
    return this.isActiveInLaitela(33) ? 10 : 1;
  },

  // Void Harvest raises both rewards of Lai'tela's Reality, so it works outside of the Reality as well
  get laitelaRewardPower() {
    return OverclockUpgrade(34).isEffectActive ? 2 : 1;
  },

  // Continuum Overdrive multiplies the purchases Continuum gives Antimatter, Infinity and Time Dimensions
  get continuumOverdrive() {
    return this.isActiveInLaitela(35) ? 3 + Laitela.difficultyTier : 1;
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
