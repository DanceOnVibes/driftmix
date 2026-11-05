// "From your crate" suggestions. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { crateFits } from "./crate.js";

const t = (id, bpm, camelot) => ({ id, name: `Track ${id}`, bpm, camelot });

test("best fits first: same tempo and key family before a stretch or a mood shift", () => {
  const pool = [t("far", 140, "8A"), t("clash", 128, "3B"), t("stretch", 125, "9A"), t("best", 128, "9A"), t("diag", 128, "9B"), t("same", 128.02, "8A")];
  const fits = crateFits({ bpm: 128, camelot: "8A" }, pool);
  assert.deepEqual(
    fits.map((f) => f.id),
    ["same", "best", "stretch"],
  );
  assert.equal(fits[0].why, "same tempo · same key");
  assert.equal(fits[2].why, "2% tempo · neighbour on the wheel");
});

test("amber pairs only with a green partner; nothing known, nothing offered", () => {
  const fits = crateFits({ bpm: 128, camelot: "8A" }, [t("diag", 128, "9B"), t("both-amber", 134, "9B"), t("nokey", 128, null)], 5);
  assert.deepEqual(
    fits.map((f) => f.id),
    ["diag"],
  );
  assert.deepEqual(crateFits({ bpm: null, camelot: "8A" }, [t("x", 128, "8A")]), []);
});

test("half and double time count", () => {
  const fits = crateFits({ bpm: 87, camelot: "5A" }, [t("dnb", 174, "5A")]);
  assert.equal(fits.length, 1);
});
