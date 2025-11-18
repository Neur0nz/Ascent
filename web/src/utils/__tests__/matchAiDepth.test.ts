import { describe, expect, it } from "vitest";
import type { SantoriniStateSnapshot } from "@/types/match";
import {
  getMatchAiDepth,
  getOppositeRole,
  getPlayerZeroRole,
  getPlayerZeroRoleFromSnapshot,
  getRoleForMoveIndex,
  isAiMatch,
} from "@/utils/matchAiDepth";

const createSnapshot = (overrides: Partial<SantoriniStateSnapshot> = {}): SantoriniStateSnapshot => ({
  version: 1,
  player: 0,
  board: Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => [0, 0, 0]),
  ),
  history: [],
  future: [],
  gameEnded: [0, 0],
  validMoves: new Array(5).fill(false),
  ...overrides,
});

describe("match AI helpers", () => {
  it("prefers explicit ai_depth over metadata", () => {
    const match = { ai_depth: 3, initial_state: createSnapshot({ metadata: { aiDepth: 1 } }) };
    expect(getMatchAiDepth(match)).toBe(3);
  });

  it("falls back to metadata depth when explicit value is missing", () => {
    const match = { initial_state: createSnapshot({ metadata: { aiDepth: 4 } }) };
    expect(getMatchAiDepth(match)).toBe(4);
  });

  it("identifies AI matches based on flag, metadata, or default opponent id", () => {
    expect(isAiMatch({ is_ai_match: true })).toBe(true);
    expect(isAiMatch({ initial_state: createSnapshot({ metadata: { aiDepth: 2 } }) })).toBe(true);
    expect(
      isAiMatch({ opponent_id: "00000000-0000-0000-0000-00000000a11a", initial_state: createSnapshot() }),
    ).toBe(true);
    expect(isAiMatch({ opponent_id: "player-123" })).toBe(false);
  });

  it("derives player zero role from metadata, snapshot player, or defaults", () => {
    expect(
      getPlayerZeroRoleFromSnapshot(createSnapshot({ metadata: { playerZeroRole: "opponent" } })),
    ).toBe("opponent");
    expect(getPlayerZeroRoleFromSnapshot(createSnapshot({ player: 1 }))).toBe("opponent");
    expect(getPlayerZeroRoleFromSnapshot(createSnapshot({ player: 2 }))).toBe("creator");
  });

  it("derives role directly from match snapshots", () => {
    const match = { initial_state: createSnapshot({ metadata: { playerZeroRole: "creator" } }) };
    expect(getPlayerZeroRole(match)).toBe("creator");
  });

  it("returns alternating roles for each move index", () => {
    expect(getRoleForMoveIndex(0, "creator")).toBe("creator");
    expect(getRoleForMoveIndex(1, "creator")).toBe("opponent");
    expect(getRoleForMoveIndex(4, "opponent")).toBe("opponent");
    expect(getRoleForMoveIndex(5, "opponent")).toBe("creator");
    expect(getRoleForMoveIndex(NaN, "creator")).toBe("creator");
    expect(getRoleForMoveIndex(-5, "opponent")).toBe("opponent");
  });

  it("returns the opposite role helper correctly", () => {
    expect(getOppositeRole("creator")).toBe("opponent");
    expect(getOppositeRole("opponent")).toBe("creator");
  });
});
