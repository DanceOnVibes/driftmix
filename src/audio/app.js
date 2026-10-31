/**
 * DriftMix as an app: install it (home screen / desktop), and know when a
 * new version is ready.
 *
 *  - The service worker (src/sw.js) is registered once the page has loaded.
 *  - When a new version has been saved in the background, `app.update` is
 *    set and the page shows "New version ready · Update". Update tells the
 *    new version to take over and reloads.
 *  - It checks for a new version every 30 minutes and whenever DriftMix comes
 *    back to the front.
 *  - Install: browsers that offer it (Chrome, Edge, Android) give an install
 *    prompt; iPhone and iPad use Share › Add to Home Screen.
 */
export const app = {
  version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev",
  update: false, // a new version is waiting
  canInstall: false, // the browser offers its install prompt
  installed: false, // running as an installed app
  ios: false, // iPhone / iPad (install by hand)
  listeners: new Set(),
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  emit() {
    for (const listener of this.listeners) listener();
  },
};

let installEvent = null;
let waiting = null;
let registration = null;

export function startApp() {
  if (typeof window === "undefined") return;
  app.installed = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  app.ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e;
    app.canInstall = true;
    app.emit();
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    app.canInstall = false;
    app.installed = true;
    app.emit();
  });
  if (!("serviceWorker" in navigator)) return;
  const register = async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      registration = reg;
      const watch = (worker) => {
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) offer(worker);
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      watch(reg.installing);
      reg.addEventListener("updatefound", () => watch(reg.installing));
      const check = () => void reg.update().catch(() => {});
      setInterval(check, 30 * 60 * 1000);
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
    } catch {
      /* no app features here (private window etc.): DriftMix works as a page */
    }
  };
  if (document.readyState === "complete") void register();
  else window.addEventListener("load", () => void register());
  // The new version took over: load it.
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloading && app.update) {
      reloading = true;
      window.location.reload();
    }
  });
}

function offer(worker) {
  waiting = worker;
  app.update = true;
  app.emit();
}

/** "Update": the new version takes over, then the page reloads. */
export function applyUpdate() {
  if (waiting) waiting.postMessage("update");
  else window.location.reload();
}

/**
 * "Check for updates" (⚙ menu): asks for a new version now instead of
 * waiting for the half-hourly check.
 * @returns {Promise<"update"|"latest"|"offline">}
 */
export async function checkForUpdate() {
  if (app.update) return "update";
  if (!registration) return "offline";
  try {
    await registration.update();
  } catch {
    return "offline";
  }
  // A new version installs in the background; give it a moment to say so.
  for (let i = 0; i < 20 && !app.update; i++) {
    if (!registration.installing) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return app.update ? "update" : "latest";
}

/** "Install app": the browser's own prompt. */
export async function install() {
  if (!installEvent) return;
  installEvent.prompt();
  try {
    await installEvent.userChoice;
  } catch {
    /* dismissed */
  }
  installEvent = null;
  app.canInstall = false;
  app.emit();
}
