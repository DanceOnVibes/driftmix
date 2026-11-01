/**
 * Switches the background workers over to Signalsmith Stretch, the
 * studio-grade time-stretch (see lib/signalsmith.js). Each worker awaits
 * `studioReady` before a job; it's a few milliseconds, once. If the engine
 * can't start on this browser, the stretch quietly stays on DriftMix's own
 * phase vocoder.
 */
import { loadSignalsmith } from "../lib/signalsmith.js";
import { useStudioStretch } from "../lib/stretch.js";

export const studioReady = loadSignalsmith().then(useStudioStretch, () => useStudioStretch(null));
