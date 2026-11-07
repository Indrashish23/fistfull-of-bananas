// Which TV is listening in which room. No network code here, so it runs in plain tests.

export type TvSocket = {
  send(data: string): void;
  isOpen(): boolean;
};

export function isRoomCode(room: unknown): room is string {
  return typeof room === "string" && /^[a-z0-9]{6,32}$/.test(room);
}

export class RelayRooms {
  private readonly tvs = new Map<string, TvSocket>();

  /** Adds a TV to its room, replacing any older connection. Returns how to take it out again. */
  join(room: string, tv: TvSocket): () => void {
    this.tvs.set(room, tv);
    return () => {
      if (this.tvs.get(room) === tv) this.tvs.delete(room);
    };
  }

  /** Passes a phone's message to its TV. Returns whether a TV was there to get it. */
  forward(room: string, message: string): boolean {
    const tv = this.tvs.get(room);
    if (!tv || !tv.isOpen()) return false;
    tv.send(message);
    return true;
  }
}
