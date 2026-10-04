import { tokenMap as T } from "./lexer";

// Keeping ownership on the persistent command state preserves the wait across saves and nested script blocks.
export const ECSchedulerCommands = [
  {
    id: "ecSchedulerRun",
    rule: $ => () => {
      $.CONSUME(T.ECSchedulerRun);
      $.OPTION(() => $.CONSUME(T.Identifier));
    },
    validate: (ctx, V) => {
      ctx.startLine = ctx.ECSchedulerRun[0].startLine;
      const pace = ctx.Identifier?.[0].image.toLowerCase();
      if (pace && !["fast", "balanced"].includes(pace)) {
        V.addError(ctx.Identifier, "Unknown EC scheduler pace", "Use fast or balanced, or omit the pace");
        return false;
      }
      return true;
    },
    compile: ctx => S => {
      const pace = ctx.Identifier?.[0].image.toLowerCase();
      if (pace) ECScheduler.data.mode = pace;
      if (S.commandState?.ecScheduler === "complete" ||
          (!ECScheduler.isRunning && ECScheduler.targetsComplete)) {
        AutomatorData.isWaiting = false;
        AutomatorData.logCommandEvent("EC scheduler targets complete; continuing script", ctx.startLine);
        return AUTOMATOR_COMMAND_STATUS.NEXT_INSTRUCTION;
      }
      if (ECScheduler.isRunning) return AUTOMATOR_COMMAND_STATUS.NEXT_TICK_SAME_INSTRUCTION;
      S.commandState = { ecScheduler: "running", line: ctx.startLine };
      // An explicit resume retries a paused session from the current game state.
      if (ECScheduler.start(S.commandState)) {
        AutomatorData.isWaiting = true;
        AutomatorData.logCommandEvent("EC scheduler started; waiting for selected targets", ctx.startLine);
      } else {
        S.commandState.ecScheduler = "paused";
        AutomatorData.logCommandEvent(`EC scheduler could not start: ${ECScheduler.data.status}`, ctx.startLine);
        AutomatorBackend.pause();
      }
      return AUTOMATOR_COMMAND_STATUS.NEXT_TICK_SAME_INSTRUCTION;
    },
    blockify: ctx => ({
      ...automatorBlocksMap["EC SCHEDULER RUN"],
      singleSelectionInput: ctx.Identifier?.[0].image.toUpperCase() || ""
    })
  },
  {
    id: "ecSchedulerToggle",
    rule: $ => () => {
      $.OR([
        { ALT: () => $.CONSUME(T.ECSchedulerOn) },
        { ALT: () => $.CONSUME(T.ECSchedulerOff) }
      ]);
      $.OR1([
        { ALT: () => $.SUBRULE($.eternityChallenge) },
        { ALT: () => $.CONSUME(T.Identifier) }
      ]);
    },
    validate: (ctx, V) => {
      ctx.startLine = (ctx.ECSchedulerOn || ctx.ECSchedulerOff)[0].startLine;
      if (ctx.Identifier && ctx.Identifier[0].image.toLowerCase() !== "all") {
        V.addError(ctx.Identifier, "Unknown EC selection", "Use all or an EC from ec1 through ec12");
        return false;
      }
      return true;
    },
    compile: ctx => () => {
      const ids = ctx.Identifier ? Array.range(1, 12) : [ctx.eternityChallenge[0].children.$ecNumber];
      for (const id of ids) ECScheduler.setEnabled(id, Boolean(ctx.ECSchedulerOn));
      AutomatorData.logCommandEvent(`EC scheduler ${ctx.ECSchedulerOn ? "enabled" : "disabled"} ` +
        `${ctx.Identifier ? "all ECs" : `EC${ids[0]}`}`, ctx.startLine);
      return AUTOMATOR_COMMAND_STATUS.NEXT_INSTRUCTION;
    },
    blockify: ctx => ({
      ...automatorBlocksMap[`EC SCHEDULER ${ctx.ECSchedulerOn ? "ON" : "OFF"}`],
      singleSelectionInput: ctx.Identifier ? "ALL" : `EC${ctx.eternityChallenge[0].children.$ecNumber}`
    })
  },
  {
    id: "ecSchedulerTarget",
    rule: $ => () => {
      $.CONSUME(T.ECSchedulerTarget);
      $.OR([
        { ALT: () => $.SUBRULE($.eternityChallenge) },
        { ALT: () => $.CONSUME(T.Identifier) }
      ]);
      $.CONSUME(T.NumberLiteral);
    },
    validate: (ctx, V) => {
      ctx.startLine = ctx.ECSchedulerTarget[0].startLine;
      if (ctx.Identifier && ctx.Identifier[0].image.toLowerCase() !== "all") {
        V.addError(ctx.Identifier, "Unknown EC selection", "Use all or an EC from ec1 through ec12");
        return false;
      }
      ctx.$target = Number(ctx.NumberLiteral?.[0].image);
      if (!Number.isInteger(ctx.$target) || ctx.$target < 1 || ctx.$target > 5) {
        V.addError(ctx, "Invalid EC completion target", "Use a whole number from 1 through 5");
        return false;
      }
      return true;
    },
    compile: ctx => () => {
      const ids = ctx.Identifier ? Array.range(1, 12) : [ctx.eternityChallenge[0].children.$ecNumber];
      for (const id of ids) ECScheduler.setTarget(id, ctx.$target);
      AutomatorData.logCommandEvent(`EC scheduler target for ${ctx.Identifier ? "all ECs" : `EC${ids[0]}`} ` +
        `set to ${ctx.$target}`, ctx.startLine);
      return AUTOMATOR_COMMAND_STATUS.NEXT_INSTRUCTION;
    },
    blockify: ctx => ({
      ...automatorBlocksMap["EC SCHEDULER TARGET"],
      singleSelectionInput: ctx.Identifier ? "ALL" : `EC${ctx.eternityChallenge[0].children.$ecNumber}`,
      singleTextInput: String(ctx.$target)
    })
  }
];
