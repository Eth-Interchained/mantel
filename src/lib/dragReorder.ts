/**
 * Drag-to-reorder — the pure math.
 *
 * The editor's block list reorders two ways: the arrows (precision,
 * keyboards, accessibility) and the grip (drag, on mouse AND touch).
 * Both funnel into the same commit: an array move + re-stamped order.
 *
 * Everything here is geometry, no DOM: the page measures card tops and
 * heights once at drag-start, and these functions answer "where would
 * it land?" and "who moves out of the way?" on every pointer frame.
 * Variable-height cards are first-class — a link card and a fully
 * expanded embed card are nothing alike, so midpoints are computed per
 * row, never assumed uniform.
 */

/** Move arr[from] to sit at index `to`, shifting neighbours. Pure. */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const next = [...arr];
  if (from === to || from < 0 || from >= arr.length || to < 0 || to >= arr.length) {
    return next;
  }
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Given the dragged card's original index, its vertical travel `dy`,
 * and the measured geometry of every card (tops + heights, same space
 * as dy — document space in practice), return the index it should land
 * at right now.
 *
 * Rule: the dragged card displaces a neighbour when its CENTER crosses
 * that neighbour's midpoint. Walk outward from `from` in the direction
 * of travel and take the farthest midpoint crossed — this is stable for
 * variable heights and never skips a row.
 */
export function dragTarget(
  from: number,
  dy: number,
  tops: readonly number[],
  heights: readonly number[],
): number {
  const n = tops.length;
  if (n === 0 || from < 0 || from >= n) return from;
  const center = tops[from] + heights[from] / 2 + dy;
  let to = from;
  if (dy < 0) {
    for (let j = from - 1; j >= 0; j--) {
      if (center < tops[j] + heights[j] / 2) to = j;
      else break;
    }
  } else if (dy > 0) {
    for (let j = from + 1; j < n; j++) {
      if (center > tops[j] + heights[j] / 2) to = j;
      else break;
    }
  }
  return to;
}

/**
 * While the drag is live the list order does NOT change (commit happens
 * on release) — instead, cards between `from` and `to` visually slide
 * out of the way by the dragged card's pitch (height + gap).
 *
 * Returns the translateY offset for card `index`: negative when it
 * slides up to fill the hole, positive when it slides down.
 */
export function siblingShift(index: number, from: number, to: number, pitch: number): number {
  if (index === from || from === to) return 0;
  if (to > from && index > from && index <= to) return -pitch;
  if (to < from && index >= to && index < from) return pitch;
  return 0;
}
