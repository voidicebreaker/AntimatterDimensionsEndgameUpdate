// Runs solver trials on several Web Workers at once. Each worker loads its own copy of the game (see
// src/workers/solver-worker.js), so trials never touch the live save and the page stays playable while solving.
// Workers are kept for a short while after a solve so that back-to-back solves skip the start-up cost.

const IDLE_SHUTDOWN_MS = 60000;
const BOOT_TIMEOUT_MS = 120000;
// Workers loading the same large script at once can collide in the browser cache, so only a few load at a time
const SPAWN_CONCURRENCY = 2;
const SPAWN_ATTEMPTS = 5;

// Turns the { decimal: "..." } values a worker sends back into Decimals again
export function reviveSolverValues(value) {
  if (Array.isArray(value)) return value.map(reviveSolverValues);
  if (value && typeof value === "object") {
    if (Object.keys(value).length === 1 && typeof value.decimal === "string") return new Decimal(value.decimal);
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, reviveSolverValues(inner)]));
  }
  return value;
}

export const SolverPool = {
  // Set by src/main.js. Referencing the worker file from here would make the worker bundle (which loads all of the
  // core, including this file) contain a reference to itself.
  createWorker: null,
  workers: [],
  failure: "",
  idleTimer: null,
  nextId: 1,

  get isSupported() {
    return typeof Worker !== "undefined" && location.protocol !== "file:" && !self.SOLVER_WORKER &&
      this.createWorker !== null;
  },

  // All cores but two, and no more than the device's memory comfortably holds (each worker is a full game copy)
  get defaultSize() {
    const cores = navigator.hardwareConcurrency || 4;
    const memoryCap = navigator.deviceMemory ? Math.max(1, Math.floor(navigator.deviceMemory * 2)) : 16;
    return Math.clamp(cores - 2, 1, memoryCap);
  },

  get maxSize() {
    return navigator.hardwareConcurrency || 4;
  },

  spawn() {
    return new Promise((resolve, reject) => {
      const worker = this.createWorker();
      const entry = { worker, pending: new Map() };
      const timeout = setTimeout(() => reject(new Error("A solver worker took too long to start.")), BOOT_TIMEOUT_MS);
      worker.onmessage = ({ data }) => {
        if (data.type === "ready") {
          clearTimeout(timeout);
          resolve(entry);
          return;
        }
        if (data.type === "bootError") {
          clearTimeout(timeout);
          reject(new Error(`A solver worker could not load the game: ${data.message}`));
          return;
        }
        const request = entry.pending.get(data.id);
        if (!request) return;
        entry.pending.delete(data.id);
        if (data.error) request.reject(new Error(data.error));
        else request.resolve(data.result);
      };
      worker.onerror = event => {
        // Handled here (the solver falls back or reports it), so it should not also surface as an uncaught error
        event.preventDefault();
        clearTimeout(timeout);
        const error = new Error(event.message || "A solver worker failed.");
        for (const request of entry.pending.values()) request.reject(error);
        entry.pending.clear();
        reject(error);
      };
    });
  },

  async spawnWithRetry() {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.spawn();
      } catch (error) {
        // Only a failure to fetch the script is worth retrying; a game load error would just repeat
        if (attempt >= SPAWN_ATTEMPTS || error.message.startsWith("A solver worker could not load the game")) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 250 * attempt));
      }
    }
  },

  // Starts (or reuses) exactly `size` workers. Resolves to false, with failure set, if workers cannot run here.
  async start(size) {
    clearTimeout(this.idleTimer);
    if (!this.isSupported) {
      this.failure = "This browser cannot run solver workers.";
      return false;
    }
    while (this.workers.length > size) this.workers.pop().worker.terminate();
    try {
      // Browsers can fail to load one large script for several workers at the same instant (a cache write
      // collision), so one worker loads it first and the rest follow a few at a time, retrying any that fail
      if (this.workers.length === 0 && size > 0) this.workers.push(await this.spawnWithRetry());
      let launching = 0;
      const launch = async() => {
        while (this.workers.length + launching < size) {
          launching++;
          try {
            this.workers.push(await this.spawnWithRetry());
          } finally {
            launching--;
          }
        }
      };
      await Promise.all(Array.range(0, SPAWN_CONCURRENCY).map(launch));
      this.failure = "";
      return true;
    } catch (error) {
      this.stop();
      this.failure = error.message;
      return false;
    }
  },

  // Every message gets an id for matching its reply, so messages must not use "id" for anything else
  request(entry, message) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      entry.pending.set(id, { resolve, reject });
      entry.worker.postMessage({ ...message, id });
    });
  },

  broadcast(message) {
    return Promise.all(this.workers.map(entry => this.request(entry, message)));
  },

  // Runs one request on the first worker, for work that only needs doing once
  single(message) {
    return this.request(this.workers[0], message);
  },

  // Hands jobs out as workers become free. onResult(job, result) runs as each one finishes, in completion order.
  async run(jobs, { message, onResult, isCancelled }) {
    let next = 0;
    const loop = async entry => {
      while (next < jobs.length && !isCancelled()) {
        const job = jobs[next++];
        const result = await this.request(entry, message(job));
        if (isCancelled()) return;
        onResult(job, reviveSolverValues(result));
      }
    };
    await Promise.all(this.workers.map(loop));
  },

  // Keeps the workers warm for a while so another solve can start straight away
  release() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), IDLE_SHUTDOWN_MS);
  },

  stop() {
    clearTimeout(this.idleTimer);
    for (const entry of this.workers) {
      entry.worker.terminate();
      for (const request of entry.pending.values()) request.reject(new Error("Solver workers were stopped."));
    }
    this.workers = [];
  },
};
