import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_OPEN_CREATE_STORAGE_KEY,
  consumeAutoOpenCreateFlag,
  scheduleAutoOpenCreate,
} from "@/utils/lobbyStorage";

const clearSession = () => {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.clear();
};

describe("lobbyStorage", () => {
  beforeEach(() => {
    clearSession();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearSession();
  });

  it("stores and consumes the auto-open flag exactly once", () => {
    scheduleAutoOpenCreate();
    expect(window.sessionStorage.getItem(AUTO_OPEN_CREATE_STORAGE_KEY)).toBe("true");

    expect(consumeAutoOpenCreateFlag()).toBe(true);
    expect(window.sessionStorage.getItem(AUTO_OPEN_CREATE_STORAGE_KEY)).toBeNull();
    expect(consumeAutoOpenCreateFlag()).toBe(false);
  });

  it("gracefully no-ops when sessionStorage is unavailable", () => {
    vi.stubGlobal("window", undefined);

    expect(() => scheduleAutoOpenCreate()).not.toThrow();
    expect(consumeAutoOpenCreateFlag()).toBe(false);
  });

  it("swallows storage errors and logs them", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const throwingWindow = {
      get sessionStorage() {
        throw new Error("blocked");
      },
    } as Window & typeof globalThis;

    vi.stubGlobal("window", throwingWindow);

    expect(() => scheduleAutoOpenCreate()).not.toThrow();
    expect(consumeAutoOpenCreateFlag()).toBe(false);
    expect(consoleSpy).toHaveBeenCalled();
  });
});
