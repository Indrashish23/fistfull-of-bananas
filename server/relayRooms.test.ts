import { describe, expect, it } from "vitest";
import { RelayRooms, isRoomCode, type TvSocket } from "./relayRooms";

function fakeTv(open = true): TvSocket & { got: string[] } {
  const got: string[] = [];
  return { got, send: (d) => got.push(d), isOpen: () => open };
}

describe("relay rooms", () => {
  it("passes a phone's message to the TV in its room", () => {
    const rooms = new RelayRooms();
    const tv = fakeTv();
    rooms.join("abc123", tv);
    expect(rooms.forward("abc123", "hello")).toBe(true);
    expect(tv.got).toEqual(["hello"]);
  });

  it("keeps rooms apart", () => {
    const rooms = new RelayRooms();
    const a = fakeTv();
    const b = fakeTv();
    rooms.join("aaaaaa", a);
    rooms.join("bbbbbb", b);
    rooms.forward("bbbbbb", "hi");
    expect(a.got).toEqual([]);
    expect(b.got).toEqual(["hi"]);
  });

  it("says so when no TV is listening", () => {
    const rooms = new RelayRooms();
    expect(rooms.forward("abc123", "hello")).toBe(false);
    rooms.join("abc123", fakeTv(false));
    expect(rooms.forward("abc123", "hello")).toBe(false);
  });

  it("lets a reloaded TV take over without the old one's exit removing it", () => {
    const rooms = new RelayRooms();
    const old = fakeTv();
    const leaveOld = rooms.join("abc123", old);
    const fresh = fakeTv();
    rooms.join("abc123", fresh);
    leaveOld();
    expect(rooms.forward("abc123", "hi")).toBe(true);
    expect(fresh.got).toEqual(["hi"]);
  });

  it("forgets a TV that leaves", () => {
    const rooms = new RelayRooms();
    const leave = rooms.join("abc123", fakeTv());
    leave();
    expect(rooms.forward("abc123", "hi")).toBe(false);
  });
});

describe("room codes", () => {
  it("accepts what the TV makes, and nothing strange", () => {
    expect(isRoomCode("k3j9x0q2ab")).toBe(true);
    expect(isRoomCode("abc")).toBe(false);
    expect(isRoomCode("../etc")).toBe(false);
    expect(isRoomCode(null)).toBe(false);
  });
});
