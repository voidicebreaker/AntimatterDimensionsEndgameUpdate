import "drag-drop-touch";
import "./shims";
import "./merge-globals";
import { browserCheck, init } from "./game";
import { DEV } from "./env";
import { watchLatestCommit } from "./commit-watcher";

SolverPool.createWorker = () => new Worker(new URL("./workers/solver-worker.js", import.meta.url));

if (browserCheck()) init();
if (DEV) watchLatestCommit();
