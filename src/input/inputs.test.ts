import { describe, expect, it } from "vitest";
import { keyName } from "./inputs";

describe("reading a key", () => {
  it("knows the remote's OK when it has no keyboard code", () => {
    expect(keyName({ key: "Enter", code: "" })).toBe("Enter");
    expect(keyName({ key: "Enter", code: "NumpadEnter" })).toBe("Enter");
  });

  it("knows the remote's arrows and Back", () => {
    expect(keyName({ key: "ArrowLeft", code: "" })).toBe("ArrowLeft");
    expect(keyName({ key: "Escape", code: "" })).toBe("Escape");
  });

  it("still reads letters by position", () => {
    expect(keyName({ key: "a", code: "KeyA" })).toBe("KeyA");
  });
});
