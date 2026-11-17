import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AWAY_AFTER, countdown, idleDeadline, idlePhase, idleState, notePresence, noteTokenUse, pollsAllowed, setIdleBound, WARN_BEFORE } from "./idle";

describe("idlePhase", () => {
  it("ends a minute short of the bound, which is when the server may refuse first, and warns two minutes before", () => {
    const used = Date.parse("2026-11-17T10:00:00Z");
    expect(idleDeadline(used, 900)).toBe(used + 14 * 60_000);
    expect(idlePhase(used, 900, used + 12 * 60_000 - 1)).toBe("active");
    expect(idlePhase(used, 900, used + 12 * 60_000)).toBe("warning");
    expect(idlePhase(used, 900, used + 14 * 60_000 - 1)).toBe("warning");
    expect(idlePhase(used, 900, used + 14 * 60_000)).toBe("over");
  });
});

describe("countdown", () => {
  it("shows minutes and seconds", () => {
    expect(countdown(120)).toBe("2:00");
    expect(countdown(65)).toBe("1:05");
    expect(countdown(0)).toBe("0:00");
  });
});

describe("the bound as the app sees it", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse("2026-11-17T10:00:00Z") });
    notePresence();
  });
  afterEach(() => {
    setIdleBound(0);
    vi.useRealTimers();
  });

  it("is off without a bound, and polls go whoever is there", () => {
    expect(idleState()).toMatchObject({ bound: 0, phase: "off" });
    vi.advanceTimersByTime(10 * AWAY_AFTER);
    expect(pollsAllowed()).toBe(true);
  });

  it("warns with a countdown, starts over with a request, and ends at its bound", () => {
    setIdleBound(300);
    const start = Date.now();
    expect(idleState()).toMatchObject({ bound: 300, phase: "active", deadline: start + 240_000 });

    vi.advanceTimersByTime(240_000 - WARN_BEFORE);
    expect(idleState()).toMatchObject({ phase: "warning", left: 120 });
    vi.advanceTimersByTime(1000);
    expect(idleState()).toMatchObject({ phase: "warning", left: 119 });

    noteTokenUse();
    expect(idleState()).toMatchObject({ phase: "active", deadline: Date.now() + 240_000 });
    vi.advanceTimersByTime(240_000);
    expect(idleState().phase).toBe("over");
  });

  it("stops the polls a minute after the last touch, and lets them go again with the next", () => {
    setIdleBound(900);
    expect(pollsAllowed()).toBe(true);
    vi.advanceTimersByTime(AWAY_AFTER - 1);
    expect(idleState().away).toBe(false);
    vi.advanceTimersByTime(1);
    expect(idleState().away).toBe(true);
    expect(pollsAllowed()).toBe(false);

    notePresence();
    expect(idleState().away).toBe(false);
    expect(pollsAllowed()).toBe(true);
  });
});
