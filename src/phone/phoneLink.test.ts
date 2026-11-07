import { describe, expect, it } from "vitest";
import { PHONE_STALE_SEC, PhoneLink } from "./phoneLink";
import { parsePhoneState, type PhoneState } from "./protocol";

const reading = (over: Partial<PhoneState> = {}): PhoneState => ({
  level: 0.5,
  db: -20,
  mic: true,
  rttMs: 12,
  ...over,
});

describe("the TV's view of a phone", () => {
  it("isn't there until a message arrives", () => {
    const p = new PhoneLink();
    expect(p.live).toBe(false);
    expect(p.level).toBe(0);
    expect(p.mic).toBe(false);
  });

  it("takes its readings", () => {
    const p = new PhoneLink();
    p.receive(reading());
    expect(p.live).toBe(true);
    expect(p.level).toBe(0.5);
    expect(p.mic).toBe(true);
  });

  it("drops a shout when the phone goes quiet", () => {
    const p = new PhoneLink();
    p.receive(reading({ level: 1 }));
    p.update(PHONE_STALE_SEC + 0.05);
    expect(p.live).toBe(false);
    expect(p.level).toBe(0);
    expect(p.mic).toBe(false);
  });

  it("comes back with the next message", () => {
    const p = new PhoneLink();
    p.receive(reading());
    p.update(PHONE_STALE_SEC + 0.05);
    p.receive(reading({ level: 0.2 }));
    expect(p.level).toBe(0.2);
  });
});

describe("reading a phone's message", () => {
  it("accepts a good one", () => {
    expect(parsePhoneState(JSON.stringify(reading()))?.level).toBe(0.5);
  });

  it("keeps the level in range", () => {
    expect(parsePhoneState(JSON.stringify(reading({ level: 7 })))?.level).toBe(1);
  });

  it("rejects anything malformed", () => {
    expect(parsePhoneState("not json")).toBeNull();
    expect(parsePhoneState("null")).toBeNull();
    expect(parsePhoneState(JSON.stringify({ level: "loud", db: 1 }))).toBeNull();
    expect(parsePhoneState(JSON.stringify({ level: 1 }))).toBeNull();
  });
});
