import { describe, expect, it, vi } from "vitest";
import { buildMatchJoinLink } from "@/utils/joinLinks";

describe("buildMatchJoinLink", () => {
  it("returns an empty string when no join key is provided", () => {
    expect(buildMatchJoinLink("")).toBe("");
  });

  it("uses the current window origin and path when no baseUrl is supplied", () => {
    const link = buildMatchJoinLink("abc123");
    expect(link).toBe("https://santorini.test/?join=abc123#lobby");
  });

  it("overrides query parameters and hash for provided baseUrl values", () => {
    const link = buildMatchJoinLink("J-Key", {
      baseUrl: "https://alpha.example.com/play?foo=bar#waiting",
      tab: "match",
    });

    expect(link).toBe("https://alpha.example.com/play?join=J-Key#match");
  });

  it("logs and falls back when baseUrl cannot be parsed", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const link = buildMatchJoinLink("team", { baseUrl: "://bad:url" });

    expect(link).toBe("://bad:url?join=team#lobby");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("returns a relative query string when baseUrl resolves to an empty string", () => {
    expect(buildMatchJoinLink("join-me", { baseUrl: "" })).toBe("?join=join-me#lobby");
  });
});
