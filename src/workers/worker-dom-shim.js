// Gives the game's page-oriented modules enough of a browser to be imported inside a Web Worker. Nothing is ever
// rendered: the fake document only absorbs the DOM calls that some modules and libraries make while loading. This
// module must be imported before any game code.
// linkedom's self-contained worker build (no optional canvas dependency) is only published under an export condition
// the lint resolver cannot follow, so it is imported by path
import { parseHTML } from "../../node_modules/linkedom/worker";

// A failure while the game loads would otherwise reach the page as an error event with no details
self.addEventListener("error", event => {
  event.preventDefault();
  self.postMessage({ type: "bootError", message: `${event.message} ${event.error?.stack ?? ""}`.trim() });
});

const dom = parseHTML(`<!DOCTYPE html><html><head></head><body><div id="ui"></div>
  <div id="background-animations"></div><div id="performance-stats"></div></body></html>`);

self.window = self;
self.SOLVER_WORKER = true;
// No script element is running a worker; some libraries read its src to locate their files while loading
Object.defineProperty(dom.document, "currentScript", { value: null });

// Keep the worker's own implementations (Event, navigator, location, timers...) and add only what is missing
const domGlobals = ["document", "Node", "Element", "HTMLElement", "SVGElement", "DocumentFragment", "Text",
  "Comment", "Range", "HTMLDivElement", "HTMLTextAreaElement", "HTMLInputElement", "HTMLCanvasElement",
  "HTMLImageElement", "HTMLStyleElement", "HTMLScriptElement", "HTMLAnchorElement", "MutationObserver"];
for (const key of domGlobals) {
  if (!(key in self) && dom[key] !== undefined) self[key] = dom[key];
}

const noop = () => undefined;
const listeners = { addEventListener: noop, removeEventListener: noop };
const emptyStyle = new Proxy({}, { get: (target, key) => (key in target ? target[key] : "") });
self.getComputedStyle = () => emptyStyle;
self.matchMedia = () => ({ matches: false, addListener: noop, removeListener: noop, ...listeners });
self.getSelection = () => ({ removeAllRanges: noop });
// Some UI components create their sounds while loading
self.Audio = function Audio() {
  return { play: () => Promise.resolve(), pause: noop, load: noop, ...listeners };
};
self.requestAnimationFrame = () => 0;
self.cancelAnimationFrame = noop;

function memoryStorage() {
  const items = new Map();
  return {
    getItem: key => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: key => items.delete(key),
    clear: () => items.clear(),
    key: index => [...items.keys()][index] ?? null,
    get length() { return items.size; },
  };
}
if (!("localStorage" in self)) self.localStorage = memoryStorage();
if (!("sessionStorage" in self)) self.sessionStorage = memoryStorage();
