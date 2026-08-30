/**
 * Drag-to-reorder math — pure geometry, no DOM. The grip and the arrows
 * both funnel into moveItem; dragTarget decides where a lifted card
 * lands from measured tops/heights (variable-height cards first-class);
 * siblingShift drives the live make-way animation while order is
 * uncommitted.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { dragTarget, moveItem, siblingShift } from "../src/lib/dragReorder";

test("moveItem: moves, clamps, never mutates", () => {
  const a = ["a", "b", "c", "d"];
  assert.deepEqual(moveItem(a, 0, 2), ["b", "c", "a", "d"], "forward move shifts neighbours up");
  assert.deepEqual(moveItem(a, 3, 0), ["d", "a", "b", "c"], "backward move shifts neighbours down");
  assert.deepEqual(moveItem(a, 1, 1), a, "same index is a no-op");
  assert.deepEqual(moveItem(a, -1, 2), a, "out-of-bounds from is a no-op");
  assert.deepEqual(moveItem(a, 0, 9), a, "out-of-bounds to is a no-op");
  assert.deepEqual(a, ["a", "b", "c", "d"], "input array is never mutated");
  // Arrow parity: a ±1 move IS the old adjacent swap.
  assert.deepEqual(moveItem(a, 1, 2), ["a", "c", "b", "d"]);
});

// Variable-height list: heights [100, 200, 100, 150], gap 12.
const HEIGHTS = [100, 200, 100, 150];
const TOPS = [0, 112, 324, 436];
// Midpoints: 50, 212, 374, 511.

test("dragTarget: lands where the CENTER crosses a neighbour's midpoint", () => {
  // Resting: no travel, no move.
  assert.equal(dragTarget(0, 0, TOPS, HEIGHTS), 0);

  // From 0 (center 50): crossing the tall card's midpoint (212) needs dy > 162.
  assert.equal(dragTarget(0, 160, TOPS, HEIGHTS), 0, "shy of the midpoint stays put");
  assert.equal(dragTarget(0, 163, TOPS, HEIGHTS), 1, "past the tall card's midpoint displaces it");
  // Between midpoints 212 and 374 → exactly one slot down.
  assert.equal(dragTarget(0, 300, TOPS, HEIGHTS), 1);
  assert.equal(dragTarget(0, 325, TOPS, HEIGHTS), 2, "second midpoint crossed");
  assert.equal(dragTarget(0, 100000, TOPS, HEIGHTS), 3, "clamps at the end");

  // Upward from 2 (center 374): midpoint of the tall card is 212.
  assert.equal(dragTarget(2, -161, TOPS, HEIGHTS), 2, "shy of the midpoint above");
  assert.equal(dragTarget(2, -163, TOPS, HEIGHTS), 1, "crossed it");
  assert.equal(dragTarget(2, -325, TOPS, HEIGHTS), 0, "crossed both");
  assert.equal(dragTarget(2, -100000, TOPS, HEIGHTS), 0, "clamps at the top");

  // Degenerates: empty and single-card lists never move.
  assert.equal(dragTarget(0, 500, [], []), 0);
  assert.equal(dragTarget(0, 500, [0], [80]), 0);
});

test("siblingShift: only cards between from and to make way", () => {
  const PITCH = 112;
  // Dragging 0 down to 2: cards 1 and 2 slide UP.
  assert.equal(siblingShift(1, 0, 2, PITCH), -PITCH);
  assert.equal(siblingShift(2, 0, 2, PITCH), -PITCH);
  assert.equal(siblingShift(3, 0, 2, PITCH), 0, "beyond the window: still");
  assert.equal(siblingShift(0, 0, 2, PITCH), 0, "the dragged card itself: inline transform, not shift");

  // Dragging 3 up to 1: cards 1 and 2 slide DOWN.
  assert.equal(siblingShift(1, 3, 1, PITCH), PITCH);
  assert.equal(siblingShift(2, 3, 1, PITCH), PITCH);
  assert.equal(siblingShift(0, 3, 1, PITCH), 0);

  // No travel: nobody moves.
  assert.equal(siblingShift(1, 2, 2, PITCH), 0);
});
