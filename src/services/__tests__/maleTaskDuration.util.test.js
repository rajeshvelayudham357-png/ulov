import assert from "node:assert/strict";
import test from "node:test";

import {
  clipSecondsToWindow,
  getIndiaDateKey,
  getIstDayBounds,
  getNightOwlWindowBounds,
  getPreviousIndiaDateKey,
} from "../maleTaskDuration.util.js";

test("IST day bounds are 24h and exclusive at end", () => {
  const { start, end } = getIstDayBounds("2026-11-16");
  assert.equal(end.getTime() - start.getTime(), 24 * 60 * 60 * 1000);
  assert.equal(getIndiaDateKey(start), "2026-11-16");
  assert.equal(getIndiaDateKey(new Date(end.getTime() - 1)), "2026-11-16");
  assert.equal(getIndiaDateKey(end), "2026-11-17");
});

test("previous India date key crosses month boundaries", () => {
  assert.equal(getPreviousIndiaDateKey("2026-11-01"), "2026-10-31");
  assert.equal(getPreviousIndiaDateKey("2026-01-01"), "2025-12-31");
});

test("Night Owl window is 21:00–24:00 IST", () => {
  const { start, end } = getNightOwlWindowBounds("2026-11-16");
  assert.equal(end.getTime() - start.getTime(), 3 * 60 * 60 * 1000);
  assert.equal(getIndiaDateKey(start), "2026-11-16");
  assert.equal(getIndiaDateKey(new Date(end.getTime() - 1)), "2026-11-16");
});

test("clipSecondsToWindow counts only overlapping seconds", () => {
  const { start, end } = getNightOwlWindowBounds("2026-11-16");

  // Fully inside window: 21:10–21:20 = 600s
  assert.equal(
    clipSecondsToWindow(
      new Date("2026-11-16T21:10:00+05:30"),
      new Date("2026-11-16T21:20:00+05:30"),
      start,
      end
    ),
    600
  );

  // Starts before window, ends inside: 20:50–21:10 → 600s
  assert.equal(
    clipSecondsToWindow(
      new Date("2026-11-16T20:50:00+05:30"),
      new Date("2026-11-16T21:10:00+05:30"),
      start,
      end
    ),
    600
  );

  // Spans midnight: 23:30–00:30 → only 30 minutes (1800s) in window
  assert.equal(
    clipSecondsToWindow(
      new Date("2026-11-16T23:30:00+05:30"),
      new Date("2026-11-17T00:30:00+05:30"),
      start,
      end
    ),
    1800
  );

  // Entirely outside (afternoon)
  assert.equal(
    clipSecondsToWindow(
      new Date("2026-11-16T15:00:00+05:30"),
      new Date("2026-11-16T15:10:00+05:30"),
      start,
      end
    ),
    0
  );

  // Boundary: exactly 59s inside
  assert.equal(
    clipSecondsToWindow(
      new Date("2026-11-16T20:59:30+05:30"),
      new Date("2026-11-16T21:00:29+05:30"),
      start,
      end
    ),
    29
  );
});
