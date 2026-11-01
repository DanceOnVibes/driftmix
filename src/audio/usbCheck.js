/**
 * "Check my USB": the DJ picks the stick, DriftMix reads its rekordbox track
 * list and analysis files and says what a CDJ/XDJ will show. Only reads:
 * nothing on the stick is changed, and nothing leaves the computer.
 */
import { readLibrary } from "../lib/usb/pdb.js";
import { readAnlz } from "../lib/usb/anlz.js";
import { usbReport, stickPath } from "../lib/usb/report.js";

export const usb = {
  status: "idle", // idle | reading | done | failed
  report: null,
  message: "",
  listeners: new Set(),
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  emit() {
    for (const listener of this.listeners) listener();
  },
};

const LIBRARY = /(^|\/)pioneer\/rekordbox\/export\.pdb$/i;

/**
 * @param {FileList|File[]} fileList  from a folder picker (each File has webkitRelativePath)
 */
export async function checkUsb(fileList) {
  const all = [...fileList];
  usb.status = "reading";
  usb.report = null;
  usb.message = "";
  usb.emit();
  try {
    if (!all.length) throw new Error("That folder is empty.");
    const pathOf = (f) => (f.webkitRelativePath || f.name).replace(/\\/g, "/");
    const libraryFile = all.find((f) => LIBRARY.test(pathOf(f)));
    // Everything relative to the stick's root (the folder that holds PIONEER).
    const root = libraryFile ? pathOf(libraryFile).replace(LIBRARY, "$1").replace(/\/$/, "") : pathOf(all[0]).split("/")[0];
    const rel = (f) => {
      const p = pathOf(f);
      return root && p.toLowerCase().startsWith(root.toLowerCase() + "/") ? p.slice(root.length + 1) : p;
    };
    const files = all.map(rel);
    const wholeStick = files.some((p) => !p.toLowerCase().startsWith("pioneer/"));
    const oneLibrary = files.some((p) => /^pioneer\/rekordbox\/exportlibrary\.db$/i.test(p));
    let library = null;
    const analysis = new Map();
    if (libraryFile) {
      library = readLibrary(await libraryFile.arrayBuffer());
      const byPath = new Map(all.map((f) => [stickPath(rel(f)), f]));
      for (const t of library.tracks) {
        const key = stickPath(t.analyzePath);
        const f = byPath.get(key);
        if (f && !analysis.has(key)) analysis.set(key, readAnlz(await f.arrayBuffer()));
      }
    }
    usb.report = usbReport({ library, files, analysis, oneLibrary, wholeStick });
    usb.report.wholeStick = wholeStick;
    usb.status = "done";
  } catch (error) {
    usb.status = "failed";
    usb.message = `Couldn't read that stick: ${error?.message || error}`;
  }
  usb.emit();
}
