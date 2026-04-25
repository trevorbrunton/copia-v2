/**
 * Client-side state machine for the v2 screen demo.
 *
 * `ScreenState` accumulates the stages produced by sequential filter
 * applications. The reducers here are pure: they take `allRows`
 * (typically the full snapshot loaded once at session start) and the
 * action, and return a new state.
 *
 * The API route is stateless and only computes the *next* stage from
 * the rows the caller supplies. The client uses these reducers to
 * stitch together sequential calls into a `ScreenState`.
 */
import {
  STAGE_IDS,
  applyOneFilter,
  makeStage,
  type FilterId,
  type FilterableSecurity,
  type Stage,
} from "@/src/screen/funnel";

export type Snapshot = {
  /** Database snapshot id, or null for in-memory tests / pre-DB usage. */
  id: string | null;
  date: string;
  collectedAt: string;
};

export type ScreenState = {
  snapshot: Snapshot;
  stages: Stage[];
  /** Pointer to the last stage in `stages`. */
  current: Stage;
};

/** Initialize state with the universe stage containing all rows. */
export function initScreenState(snapshot: Snapshot, allRows: FilterableSecurity[]): ScreenState {
  const universe = makeStage(STAGE_IDS.UNIVERSE, allRows);
  return {
    snapshot,
    stages: [universe],
    current: universe,
  };
}

/** Reset state to the universe stage. Snapshot is preserved. */
export function resetScreenState(state: ScreenState, allRows: FilterableSecurity[]): ScreenState {
  return initScreenState(state.snapshot, allRows);
}

/**
 * Advance state by applying one filter to the rows currently in
 * `state.current`. The filter operates on the subset of `allRows`
 * whose tickers are in `state.current.tickers`, so each call composes
 * naturally with the previous one.
 */
export function applyFilterToState(
  state: ScreenState,
  filterId: FilterId,
  allRows: FilterableSecurity[]
): ScreenState {
  const currentTickers = new Set(state.current.tickers);
  const inputRows = allRows.filter((r) => currentTickers.has(r.ticker));
  const outputRows = applyOneFilter(inputRows, filterId);
  const newStage = makeStage(filterId, outputRows);

  return {
    snapshot: state.snapshot,
    stages: [...state.stages, newStage],
    current: newStage,
  };
}
