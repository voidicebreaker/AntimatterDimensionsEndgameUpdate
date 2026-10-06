// The scheduler uses the same purchase/reset APIs as the UI. It never awards completions or refunds studies itself.
// Study routes are starting strategies adapted from the supplied Ninja progression scripts, not fixed TT gates.
const EC_ROUTES = [
  "infinity,active", "time,active", "infinity,active", "time,idle",
  "infinity,active", "infinity,active", "antimatter,active", "time,idle",
  "time,active", "antimatter,active", "antimatter,active", "time,passive"
];
const EC_ORDER = [2, 3, 1, 5, 4, 6, 7, 8, 9, 10, 11, 12];

export const ECScheduler = {
  acting: false,
  runtime: null,

  get data() { return player.ecScheduler; },
  get isUnlocked() { return PlayerProgress.realityUnlocked(); },
  get isRunning() { return Boolean(this.data?.running); },
  get automatorOwned() { return this.isRunning && Boolean(this.runtime?.automatorState); },
  get targetsComplete() {
    return this.data.enabled.every((on, i) => !on || EternityChallenge(i + 1).completions >= this.data.targets[i]);
  },
  get totalTT() { return Currency.timeTheorems.value.plus(TimeTheorems.calculateTimeStudiesCost()); },
  get limits() {
    return this.data.mode === "fast"
      ? { stall: 12, trial: 45, farm: 90, bulk: 0.3 }
      : { stall: 30, trial: 180, farm: 300, bulk: 1.5 };
  },

  get unavailableReason() {
    if (!this.isUnlocked) return "Reach Reality to use the EC scheduler.";
    if (isInCelestialReality() || Pelle.isDoomed || Slabdrill.isCursed || player.disablePostReality ||
        LHC.voidRunning || player.universes.current !== 0 || player.compression.active ||
        player.endgame.overcharge.isRunning) return "Paused: this special run is not supported yet.";
    if (player.dilation.active) return "Exit Time Dilation before starting the EC scheduler.";
    if (Player.isInAntimatterChallenge) return "Exit the current Normal or Infinity Challenge first.";
    if (GameEnd.creditsEverClosed) return "The game has ended.";
    if (!player.auto.autobuyersOn) return "Enable the autobuyer master switch to supply Dimensions and Galaxies.";
    const locks = [RealityUpgrade(6), RealityUpgrade(10), RealityUpgrade(12), RealityUpgrade(13), RealityUpgrade(15),
      ImaginaryUpgrade(15), ImaginaryUpgrade(19), ImaginaryUpgrade(24), DualityUpgrade(15), DualityUpgrade(19)];
    if (locks.some(upgrade => upgrade.isLockingMechanics)) return "Pause the active upgrade requirement lock first.";
    return "";
  },

  newRuntime() {
    this.runtime = {
      elapsed: 0, actionElapsed: 0, phaseTime: 0, stalled: 0, farmTime: 0, cooldowns: {}, failures: {},
      metrics: [], fingerprint: this.fingerprint(), progression: this.progressionKey(),
      pendingSince: null, lastPending: 0, failurePending: false, plan: null,
      beforeCompletions: 0, crunchTime: 0, farmEternityTime: 0, farmPlans: null,
      initialCompletions: EternityChallenges.completions,
      controlledAutobuyers: new Set([Autobuyer.bigCrunch, Autobuyer.eternity, Autobuyer.reality,
        Autobuyer.timeTheorem, Autobuyer.epMult, Autobuyer.replicantiGalaxy,
        ...Autobuyer.infinityDimension.zeroIndexed, ...Autobuyer.timeDimension.zeroIndexed,
        ...Autobuyer.replicantiUpgrade.zeroIndexed])
    };
  },

  fingerprint() {
    return `${player.timestudy.studies.join(",")}|${player.challenge.eternity.unlocked}|` +
      `${player.challenge.eternity.current}|${player.respec}`;
  },

  progressionKey() {
    return [EternityChallenges.completions, player.reality.upgradeBits, [...player.reality.perks].join(","),
      Glyphs.active.filter(Boolean).map(g => `${g.id}:${g.level}:${g.strength}`).join(","),
      player.overclock.enabled, player.overclock.power, player.overclock.upgradeBits,
      player.overclock.disabledUpgradeBits, player.overclock.maxAchievements,
      player.overclock.maxCelestials].join(";");
  },

  log(message) {
    this.data.status = message;
    if (this.data.log[0]?.message === message) return;
    this.data.log.unshift({ message, time: Date.now() });
    this.data.log.splice(12);
  },

  start(automatorState = null) {
    if (this.automatorOwned) this.pause("EC scheduler restarted from its panel; Automator paused.");
    const reason = this.unavailableReason;
    if (reason) {
      this.log(reason);
      return false;
    }
    if (this.targetsComplete) {
      this.log("All selected targets are complete. Enable an EC or increase its target.");
      return false;
    }
    const current = player.challenge.eternity.current;
    if (current && (!this.data.enabled[current - 1] ||
        EternityChallenge(current).completions >= this.data.targets[current - 1])) {
      this.log("Include the current EC in your targets or exit it before starting.");
      return false;
    }
    this.newRuntime();
    this.runtime.automatorState = automatorState;
    this.data.running = true;
    this.data.current = current;
    this.data.phase = current ? "run" : "select";
    if (current) this.runtime.beforeCompletions = EternityChallenge(current).completions;
    this.log(current ? `Resuming EC${current}.` : "Selecting the next attainable EC tier.");
    return true;
  },

  pause(message = "Paused. Your current studies and challenge are kept.", completed = false) {
    const commandState = this.isRunning ? this.runtime?.automatorState : null;
    if (this.runtime) {
      this.runtime.completedTiers = Math.max(0, EternityChallenges.completions - this.runtime.initialCompletions);
    }
    this.data.running = false;
    this.log(message);
    if (commandState) {
      commandState.ecScheduler = completed ? "complete" : "paused";
      AutomatorData.isWaiting = false;
      AutomatorData.logCommandEvent(`EC scheduler: ${message}`, commandState.line);
      if (!completed) AutomatorBackend.pause();
    }
  },

  stop() {
    this.pause(this.automatorOwned ? "EC scheduler stopped. Automator paused on its scheduler command."
      : "Stopped. Prestige autobuyers and the Automator have control again.");
    this.data.phase = "idle";
    this.data.current = 0;
    this.runtime = null;
  },

  // Temporary ownership leaves every saved autobuyer setting unchanged, including settings edited while running.
  controlsAutobuyer(autobuyer) {
    return this.isRunning && Boolean(this.runtime?.controlledAutobuyers.has(autobuyer));
  },

  setEnabled(id, enabled) {
    this.data.enabled.splice(id - 1, 1, Boolean(enabled));
    if (this.runtime) this.runtime.farmPlans = null;
    if (!enabled && this.isRunning && this.data.current === id) this.pause(`EC${id} disabled. Current run kept.`);
  },

  setTarget(id, value) {
    const target = Math.max(1, Math.min(5, Math.floor(Number(value) || 1)));
    this.data.targets.splice(id - 1, 1, target);
    if (this.runtime) this.runtime.farmPlans = null;
  },

  setTree(id, value) {
    const tree = value.trim();
    if (tree && (!TimeStudyTree.isValidImportString(tree) || tree.includes("|") ||
        new TimeStudyTree(tree).invalidStudies.length > 0)) {
      this.log("Use a normal Time Study list without an EC suffix, or leave the route blank for automatic selection.");
      return false;
    }
    this.data.trees.splice(id - 1, 1, tree);
    if (this.isRunning) this.pause("Study route changed. Resume to re-evaluate the plan.");
    return true;
  },

  route(id) {
    if (this.data.trees[id - 1]) return this.data.trees[id - 1];
    const [dimension, pace] = EC_ROUTES[id - 1].split(",");
    if (id === 5) return "11-33,42,51,61,infinity,111";
    // TS62 is optional and requires EC5 or its bypass perk. It must never gate the first ECs.
    let route = `11-61,${dimension},111,${pace},151-171`;
    if (id >= 10 || (id === 4 && EternityChallenge(4).completions >= 4)) route += ",181";
    if (id === 11) route += ",191,211,222,231";
    if (id === 12) route += ",193,214,227,234";
    return route;
  },

  plan(id) {
    const tree = new TimeStudyTree(this.route(id));
    const studies = [...new Set(tree.selectedStudies)];
    const study = TimeStudy.eternityChallenge(id);
    const cost = studies.reduce((sum, s) => sum + s.cost, study.cost);
    let reason = "";
    const missing = studies.find(s => !tree.purchasedStudies.includes(s));
    if (!studies.length || missing ||
        !study.config.requirement.some(n => studies.includes(TimeStudy(n)))) {
      reason = missing ? `Study ${missing.id} needs prerequisites or a different path.`
        : "Study route does not reach this EC's unlock.";
    }
    if (id >= 11 && studies.some(s => study.config.secondary.forbiddenStudies.includes(s.id))) {
      reason = "This EC needs its dedicated Dimension path.";
    }
    const structuralReason = reason;
    if (!reason && this.totalTT.lt(cost)) {
      reason = `Needs ${format(new Decimal(cost).minus(this.totalTT), 0, 0)} more TT.`;
    }
    return { id, studies, cost, reason, structuralReason };
  },

  compatible(plan) {
    if (player.challenge.eternity.unlocked && player.challenge.eternity.unlocked !== plan.id) return false;
    const tree = new TimeStudyTree([...TimeStudy.boughtNormalTS(), ...plan.studies]);
    if (plan.id >= 11 && TimeStudy.eternityChallenge(plan.id).hasForbiddenStudies) return false;
    return plan.studies.every(s => tree.purchasedStudies.includes(s));
  },

  changePhase(phase) {
    this.data.phase = phase;
    this.runtime.phaseTime = 0;
    this.runtime.stalled = 0;
    this.runtime.metrics = [];
    this.runtime.pendingSince = null;
    this.runtime.lastPending = 0;
  },

  select() {
    const candidates = EC_ORDER.filter(id => this.data.enabled[id - 1] &&
      EternityChallenge(id).completions < this.data.targets[id - 1]);
    if (!candidates.length) {
      this.pause("All selected EC targets are complete.", true);
      return;
    }
    // An unlocked EC can forbid other Dimension paths even in a virtual tree. Clear it through a paid Eternity
    // before planning another route; merely setting respec or ignoring the conflict would leave the planner stuck.
    if (player.challenge.eternity.unlocked) {
      this.data.current = 0;
      this.changePhase("respec");
      this.log("Waiting for an Eternity to release the previously unlocked EC.");
      return;
    }
    const plans = candidates.map(id => this.plan(id));
    for (const plan of plans) {
      if ((this.runtime.cooldowns[plan.id] || 0) <= this.runtime.elapsed) {
        this.data.notes.splice(plan.id - 1, 1, plan.reason);
      }
    }
    // Start with inexpensive tiers; a previous failed probe costs priority until its cooldown expires.
    const priority = id => (id >= 11 ? 6 : EternityChallenge(id).completions);
    plans.sort((a, b) => (priority(a.id) - priority(b.id)) ||
      a.cost - b.cost || EC_ORDER.indexOf(a.id) - EC_ORDER.indexOf(b.id));
    const plan = plans.find(p => !p.reason && (this.runtime.cooldowns[p.id] || 0) <= this.runtime.elapsed);
    if (!plan) {
      this.data.current = 0;
      this.runtime.farmPlans = plans;
      this.changePhase("farm");
      this.log(this.farmStatus);
      return;
    }
    this.runtime.plan = plan;
    this.data.current = plan.id;
    this.changePhase("prepare");
    this.log(`Preparing EC${plan.id}, target ${this.data.targets[plan.id - 1]} completions.`);
  },

  buyStudyExtras(id, reserve = 0) {
    if (id && this.data.trees[id - 1]) return;
    const [dim, pace] = (id ? EC_ROUTES[id - 1] : "time,active").split(",");
    const tail = id === 11 ? "191-193,211-213,222,223,225,231,233"
      : "191-214,222,224,226,228,232,234";
    const tree = new TimeStudyTree(`11-62,${id ? dim : "time"},111,${id ? pace : "active"},151-181,${tail}`);
    for (const study of tree.selectedStudies) {
      if (Currency.timeTheorems.value.minus(reserve).gte(study.cost)) study.purchase(true);
    }
    // A second Dimension path is useful only when the game's own rules allow it.
    if (id !== 11 && id !== 12 && TimeStudy(201).isBought) {
      for (const study of new TimeStudyTree(dim === "time" ? "infinity" : "time").selectedStudies) {
        if (Currency.timeTheorems.value.minus(reserve).gte(study.cost)) study.purchase(true);
      }
    }
  },

  prepare() {
    const plan = this.runtime.plan;
    if (EternityChallenge(plan.id).completions >= this.data.targets[plan.id - 1]) {
      this.data.current = 0;
      this.changePhase("select");
      return;
    }
    const ecStudy = TimeStudy.eternityChallenge(plan.id);
    if (this.compatible(plan)) {
      TimeStudyTree.commitToGameState(plan.studies);
      if (plan.studies.every(s => s.isBought)) {
        this.buyStudyExtras(plan.id, ecStudy.isBought ? 0 : ecStudy.cost);
        if (!ecStudy.isBought) ecStudy.purchase(true);
        if (ecStudy.isBought) {
          const before = EternityChallenge(plan.id).completions;
          if (EternityChallenge(plan.id).start(true) && EternityChallenge(plan.id).isRunning) {
            this.runtime.beforeCompletions = before;
            this.changePhase("run");
            this.log(`Running EC${plan.id}. Entry verified.`);
            return;
          }
          this.defer("Challenge entry was refused.");
          return;
        }
        const requirement = ecStudy.config.secondary.resource?.() || "study path";
        this.data.status = `EC${plan.id}: building ${requirement} ` +
          `(${format(ecStudy.requirementCurrent)} / ${format(ecStudy.requirementTotal)}).`;
        this.crunch();
        // EC1 specifically requires repeated Eternities. Other entry requirements need the current run to grow.
        if (plan.id === 1 && Player.canEternity) eternity(false, true);
      } else {
        const missing = plan.studies.find(s => !s.isBought);
        this.data.status = `EC${plan.id}: waiting for Study ${missing.id} ` +
          `(${format(Currency.timeTheorems.value)} unspent TT; costs ${format(missing.cost)} TT).`;
      }
    } else {
      this.data.status = `Preparing EC${plan.id}: waiting for an Eternity to respec the current tree.`;
      this.crunch();
      if (Player.canEternity) {
        const previousRespec = player.respec;
        player.respec = true;
        if (!eternity(false, true)) player.respec = previousRespec;
      }
    }
    if (this.runtime.stalled > this.limits.stall || this.runtime.phaseTime > this.limits.trial) {
      this.defer("Entry requirement or study preparation did not finish within the trial budget.");
    }
  },

  buyResources() {
    // Buy-10 autobuyers cannot seed a fresh run with only 10 AM while starting-resource achievements are locked.
    if (AntimatterDimension(1).amount.eq(0)) buyOneDimension(1);
    // Buy a share of EP production first, leaving EP for TT and the remaining upgrades.
    for (let tier = 8; tier >= 1; tier--) buyMaxTimeDimension(tier, 0.02);
    TimeTheorems.buyMax(true);
    for (const upgrade of [EternityUpgrade.idMultEP, EternityUpgrade.idMultEternities,
      EternityUpgrade.idMultICRecords, EternityUpgrade.tdMultAchs,
      EternityUpgrade.tdMultTheorems, EternityUpgrade.tdMultRealTime]) {
      if (!upgrade.isBought) upgrade.purchase();
    }
    EternityUpgrade.epMult.buyMax(true);
    if (EternityChallenge(8).isRunning) this.buyEC8();
    else {
      InfinityDimensions.buyMax();
      Replicanti.unlock();
      if (Replicanti.areUnlocked) {
        for (const upgrade of Object.values(ReplicantiUpgrade)) upgrade.autobuyerTick();
      }
    }
    if (Replicanti.galaxies.canBuyMore) replicantiGalaxy(true);
  },

  buyEC8() {
    // Seed ID1, then preserve all remaining purchases for ID8. Do not run generic max-all here.
    InfinityDimensions.all.forEach(d => d.unlock());
    if (InfinityDimension(1).baseAmount.eq(0)) InfinityDimension(1).buySingle();
    if (InfinityDimension(1).baseAmount.gt(0)) InfinityDimension(8).buyMax(false);
    Replicanti.unlock();
    if (!Replicanti.areUnlocked) return;
    const targets = [this.data.ec8Chance, this.data.ec8Interval];
    // Derive spent purchases from game state so pause/reload/manual purchases cannot reset the allocation.
    const spent = [Math.round(player.replicanti.chance.times(100).toNumber()) - 1,
      Math.round(Math.log(player.replicanti.interval.toNumber() / 1000) / Math.log(0.9))];
    const upgrades = [ReplicantiUpgrade.chance, ReplicantiUpgrade.interval];
    for (let i = 0; i < 2; i++) {
      for (let count = 0; count < 40 && spent[i] < targets[i] && upgrades[i].canBeBought; count++) {
        const before = player.eterc8repl;
        upgrades[i].purchase();
        spent[i] += before - player.eterc8repl;
        if (before === player.eterc8repl) break;
      }
      if (spent[i] < targets[i] && !upgrades[i].isCapped) return;
    }
    for (let count = 0; count < 40 && ReplicantiUpgrade.galaxies.canBeBought; count++) {
      ReplicantiUpgrade.galaxies.purchase();
    }
  },

  crunch() {
    if (!Player.canCrunch) return;
    const gained = gainedInfinityPoints();
    const running = EternityChallenge.current;
    // TS181 supplies IP without resetting the growing run. EC11 in particular loses most of its progress to
    // repeated Crunches. EC10 is the exception: it benefits directly from building Infinities.
    if (TimeStudy(181).isBought && running && running.id !== 10) {
      if (running.id === 4) return;
      // TS181 only yields 1% of the Crunch value per second, so a hard final tier can take minutes to arrive
      // passively. Crunch exactly when doing so reaches a tier that the run has not already reached.
      const reached = Math.max(running.completionsAtIP(player.records.thisEternity.maxIP), running.completions);
      if (reached >= running.maxCompletions || (running.isGoalReached && !Perk.studyECBulk.isBought) ||
          gained.lt(running.goalAtCompletions(reached))) return;
    } else if (EternityChallenge(4).isRunning) {
      const ec = EternityChallenge(4);
      const nextInfinities = Currency.infinities.value.plus(gainedInfinities().round());
      if (nextInfinities.gt(ec.config.restriction(ec.completions))) return;
      // Spend the limited Crunches on a substantial improvement, never merely on a timer.
      if (gained.lt(ec.currentGoal) && gained.lt(player.records.thisEternity.maxIP.max(1).times(1e10))) return;
    } else {
      const buildingInfinities = this.data.current === 4 || EternityChallenge(10).isRunning;
      const firstCrunch = player.records.thisEternity.maxIP.lt(1);
      if (gained.lt(player.records.thisEternity.maxIP.max(1).times(10)) &&
          !((buildingInfinities || firstCrunch) && this.runtime.crunchTime >= 2)) return;
    }
    bigCrunchReset();
    this.runtime.crunchTime = 0;
  },

  claim() {
    const id = this.data.current;
    const before = EternityChallenge(id).completions;
    if (!EternityChallenge(id).isRunning || !EternityChallenge(id).canBeCompleted) return false;
    if (!eternity(false, true)) {
      this.defer("Eternity was refused.");
      return false;
    }
    const after = EternityChallenge(id).completions;
    if (after <= before) {
      this.pause(`EC${id}: no new completion was recorded; paused for inspection.`);
      return false;
    }
    this.log(`EC${id}: claimed ${after - before} tier${after - before === 1 ? "" : "s"} (${after}/5).`);
    this.data.notes.splice(id - 1, 1, `${after}/5 completed.`);
    this.runtime.farmTime = 0;
    this.runtime.cooldowns = {};
    this.runtime.failures = {};
    this.data.current = 0;
    this.changePhase("select");
    return true;
  },

  run() {
    const id = this.data.current;
    const ec = EternityChallenge(id);
    if (!ec.isRunning) {
      if (this.runtime.failurePending) {
        this.runtime.failurePending = false;
        this.defer("Challenge restriction failed; a stronger run is needed.");
      } else if (ec.completions > this.runtime.beforeCompletions) {
        this.log(`EC${id}: completion changed externally; re-evaluating.`);
        this.data.current = 0;
        this.changePhase("select");
      } else this.pause("The current challenge changed outside the scheduler. Paused.");
      return;
    }
    if (ec.completions >= this.data.targets[id - 1]) {
      ec.exit(false);
      this.data.current = 0;
      this.changePhase("select");
      return;
    }
    if (!ec.canBeCompleted || (id !== 4 && id !== 12)) this.crunch();
    const pending = ec.gainedCompletionStatus;
    if (pending.gainedCompletions > 0) {
      if (pending.totalCompletions !== this.runtime.lastPending) {
        this.runtime.lastPending = pending.totalCompletions;
        this.runtime.pendingSince = this.runtime.actionElapsed;
      }
      const enough = pending.totalCompletions >= this.data.targets[id - 1];
      // Restriction challenges are claimed immediately; their next production tick can invalidate a tier.
      if (!Perk.studyECBulk.isBought || enough || id === 4 || id === 12 ||
          this.runtime.actionElapsed - this.runtime.pendingSince >= this.limits.bulk) {
        this.claim();
        return;
      }
    }
    this.data.status = `EC${id}: ${ec.completions}/5 complete; ${pending.gainedCompletions} ready to claim. ` +
      `IP ${format(player.records.thisEternity.maxIP)} / ${format(ec.currentGoal)}.`;
    if (pending.gainedCompletions > 0) {
      const remaining = Math.max(0, this.limits.bulk - (this.runtime.actionElapsed - this.runtime.pendingSince));
      this.data.status += ` Bulk window: ${format(remaining, 2, 2)} Overclock-adjusted seconds left.`;
    }
    if (this.runtime.stalled > this.limits.stall || this.runtime.phaseTime > this.limits.trial) {
      if (pending.gainedCompletions > 0) this.claim();
      else this.defer("No completion within the trial budget. Farming before retrying.");
    }
  },

  defer(reason) {
    const id = this.data.current;
    if (id && EternityChallenge(id).isRunning) EternityChallenge(id).exit(false);
    const attempts = (this.runtime.failures[id] || 0) + 1;
    this.runtime.failures[id] = attempts;
    this.runtime.cooldowns[id] = this.runtime.elapsed + Math.min(30 * 2 ** (attempts - 1), 300);
    this.data.notes.splice(id - 1, 1, reason);
    this.log(`EC${id} deferred: ${reason}`);
    this.data.current = 0;
    this.changePhase("select");
  },

  get farmStatus() {
    const plans = this.runtime?.farmPlans || [];
    const available = plans.filter(p => !p.structuralReason &&
      (this.runtime.cooldowns[p.id] || 0) <= this.runtime.elapsed).sort((a, b) => a.cost - b.cost);
    if (available.length) {
      const plan = available[0];
      return `Waiting for TT for EC${plan.id}: ${format(this.totalTT)} / ${format(plan.cost)} total TT ` +
        `(including purchased studies).`;
    }
    const retry = plans.filter(p => !p.structuralReason)
      .sort((a, b) => this.runtime.cooldowns[a.id] - this.runtime.cooldowns[b.id])[0];
    if (retry) {
      const remaining = Math.max(0, this.runtime.cooldowns[retry.id] - this.runtime.elapsed);
      return `Farming before retrying EC${retry.id}: ${format(remaining, 1, 1)} active seconds left. ` +
        `${this.data.notes[retry.id - 1]}`;
    }
    const plan = plans[0];
    return plan
      ? `Waiting for EC${plan.id} prerequisites: ${plan.structuralReason}` : "Rechecking selected EC targets.";
  },

  get diagnostics() {
    if (!this.runtime) return [];
    const phases = { select: "Selecting a challenge", prepare: "Buying studies / meeting entry requirements",
      run: "Inside a challenge", farm: "Farming prerequisites", respec: "Releasing the previous study tree" };
    const lines = [
      `${this.isRunning ? phases[this.data.phase] : "Session stopped"}. ` +
        `${this.isRunning ? Math.max(0, EternityChallenges.completions - this.runtime.initialCompletions)
          : this.runtime.completedTiers || 0} tiers completed in ` +
        `${format(this.runtime.elapsed, 2, 2)} active seconds.`,
      `Time Theorems: ${format(Currency.timeTheorems.value)} unspent; ${format(this.totalTT)} total.`,
      Perk.studyECBulk.isBought ? "ECB unlocked: all reachable tiers can be claimed in one Eternity."
        : "ECB not unlocked: each tier requires its own challenge run and Eternity."
    ];
    if (this.data.current && this.runtime.plan) {
      lines.push(`EC${this.data.current} route and unlock cost: ${format(this.runtime.plan.cost)} TT. ` +
        "Optional extra studies do not block entry.");
    }
    return lines;
  },

  farm() {
    if (this.runtime.farmTime > this.limits.farm) {
      this.pause("No further EC progress within the farming budget. " +
        "Improve your build or use longer trials, then resume.");
      return;
    }
    // Recheck as soon as a route is affordable or a cooldown expires. The two-second polling interval must not
    // impose a real-time delay on a build which earned its TT in a single Overclock subtick.
    const plans = this.runtime.farmPlans;
    if (!plans || plans.some(p => !p.structuralReason && this.totalTT.gte(p.cost) &&
        (this.runtime.cooldowns[p.id] || 0) <= this.runtime.elapsed)) {
      this.changePhase("select");
      return;
    }
    this.data.status = this.farmStatus;
    this.buyStudyExtras(0);
    this.crunch();
    if (Player.canEternity && (gainedEternityPoints().gte(Currency.eternityPoints.value.max(1)) ||
        this.runtime.farmEternityTime > 5)) {
      eternity(false, true);
      this.runtime.farmEternityTime = 0;
    }
    if (this.runtime.phaseTime >= 2) this.changePhase("select");
  },

  clearUnlocked() {
    this.crunch();
    if (Player.canEternity) {
      const previousRespec = player.respec;
      player.respec = true;
      if (eternity(false, true)) this.changePhase("select");
      else player.respec = previousRespec;
    }
    if (this.runtime.phaseTime > this.limits.trial) {
      this.pause("Could not reach an Eternity to release the old EC. Improve the current build, then resume.");
    }
  },

  updateProgress(seconds) {
    const id = this.data.current;
    const requirement = id && id <= 10 ? TimeStudy.eternityChallenge(id).requirementCurrent : 0;
    const metrics = [this.totalTT, player.records.thisEternity.maxIP, Currency.eternityPoints.value,
      Currency.eternities.value, requirement, Currency.infinityPower.value, Currency.antimatter.value]
      .map(v => new Decimal(v).max(1).log10().toNumber());
    if (metrics.some((v, i) => v > (this.runtime.metrics[i] ?? -1) + 0.01)) this.runtime.stalled = 0;
    else this.runtime.stalled += seconds;
    this.runtime.metrics = metrics.map((v, i) => Math.max(v, this.runtime.metrics[i] ?? v));
  },

  tick(elapsedMs, actionMs = elapsedMs) {
    if (!this.isRunning) return;
    if (!this.runtime) {
      this.pause("Loaded a saved session. Resume to recheck the current run.");
      return;
    }
    const reason = this.unavailableReason;
    if (reason) {
      this.pause(reason);
      return;
    }
    if (this.fingerprint() !== this.runtime.fingerprint && !this.runtime.failurePending) {
      this.pause("Time Studies or the unlocked challenge changed manually. Resume to re-evaluate.");
      return;
    }
    const seconds = Math.max(0, Math.min(Number(elapsedMs) || 0, 250)) / 1000;
    const actionSeconds = Number.isFinite(actionMs) ? Math.max(0, actionMs) / 1000 : 0;
    this.runtime.elapsed += seconds;
    this.runtime.actionElapsed += actionSeconds;
    this.runtime.phaseTime += seconds;
    this.runtime.farmTime += seconds;
    this.runtime.crunchTime += actionSeconds;
    this.runtime.farmEternityTime += actionSeconds;
    const key = this.progressionKey();
    if (key !== this.runtime.progression) {
      this.runtime.progression = key;
      this.runtime.cooldowns = {};
      this.runtime.failures = {};
      this.runtime.farmTime = 0;
      this.runtime.farmPlans = null;
    }
    this.updateProgress(seconds);
    this.acting = true;
    try {
      // Claim before purchases; spending currencies must not delay a completed challenge.
      if (this.data.phase === "run") this.run();
      if (!this.isRunning) return;
      this.buyResources();
      // Selection, study purchases and verified entry need no intervening production frame. Continue through
      // ready phases, stopping at a real resource requirement; bound the work even with malformed custom routes.
      for (let step = 0; step < 8 && this.isRunning; step++) {
        const phase = this.data.phase;
        switch (phase) {
          case "select":
            this.select();
            break;
          case "prepare":
            this.prepare();
            break;
          case "farm":
            this.farm();
            break;
          case "respec":
            this.clearUnlocked();
            break;
          default: return;
        }
        if (this.data.phase === phase) break;
        if (this.data.phase === "run") {
          // Challenge entry resets Dimensions. Supply its initial purchases now instead of losing a full tick.
          this.buyResources();
          break;
        }
      }
    } finally {
      this.acting = false;
      this.runtime.fingerprint = this.fingerprint();
    }
  },

  onLoad() {
    this.runtime = null;
    // GAME_LOAD precedes rebuilding the executable Automator stack; inspect only its persistent state here.
    for (const entry of player.reality.automator.state.stack) {
      if (entry.commandState?.ecScheduler !== "running") continue;
      entry.commandState.ecScheduler = "paused";
      AutomatorBackend.pause();
    }
    if (this.isRunning) this.pause("Loaded a saved session. Resume to recheck studies and challenge progress.");
  },

  onManualPrestige() {
    if (this.isRunning && !this.acting) this.pause("A prestige was triggered outside the scheduler. Paused.");
  }
};

EventHub.logic.on(GAME_EVENT.GAME_LOAD, () => ECScheduler.onLoad());
EventHub.logic.on(GAME_EVENT.BIG_CRUNCH_BEFORE, () => ECScheduler.onManualPrestige());
EventHub.logic.on(GAME_EVENT.ETERNITY_RESET_BEFORE, () => ECScheduler.onManualPrestige());
EventHub.logic.on(GAME_EVENT.REALITY_RESET_BEFORE, () => ECScheduler.onManualPrestige());
EventHub.logic.on(GAME_EVENT.ENDGAME_RESET_BEFORE, () => ECScheduler.onManualPrestige());
EventHub.logic.on(GAME_EVENT.DOOM_REALITY_BEFORE, () => ECScheduler.onManualPrestige());
EventHub.logic.on(GAME_EVENT.CHALLENGE_FAILED, () => {
  if (ECScheduler.isRunning && ECScheduler.runtime) ECScheduler.runtime.failurePending = true;
});
