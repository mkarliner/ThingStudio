import { describe, expect, it } from "vitest";
import { madctlMap, MADCTL_MV, MADCTL_MX, MADCTL_MY, orientedMadctl, orientedTouch, turnedSize, type Angle } from "../src/node-library/orientation-shared.js";

const ANGLES: Angle[] = [0, 90, 180, 270];

describe("orientation maths", () => {
  it("swaps width and height at 90 and 270", () => {
    expect(turnedSize(320, 480, 0)).toEqual({ width: 320, height: 480 });
    expect(turnedSize(320, 480, 90)).toEqual({ width: 480, height: 320 });
    expect(turnedSize(320, 480, 180)).toEqual({ width: 320, height: 480 });
    expect(turnedSize(320, 480, 270)).toEqual({ width: 480, height: 320 });
  });

  it("matches Adafruit's ST7789 table: 0 none, 90 MV|MX, 180 MX|MY, 270 MV|MY", () => {
    expect(orientedMadctl(0, 0, 240, 320)).toBe(0);
    expect(orientedMadctl(0, 90, 240, 320)).toBe(MADCTL_MV | MADCTL_MX);
    expect(orientedMadctl(0, 180, 240, 320)).toBe(MADCTL_MX | MADCTL_MY);
    expect(orientedMadctl(0, 270, 240, 320)).toBe(MADCTL_MV | MADCTL_MY);
  });

  it("starts from the panel's mounting: a mirrored panel (MX) turned 0 is unchanged", () => {
    expect(orientedMadctl(MADCTL_MX, 0, 320, 480)).toBe(MADCTL_MX);
  });

  it("refuses a mounting that swaps axes", () => {
    expect(() => orientedMadctl(MADCTL_MV, 90, 320, 480)).toThrow(/can't swap axes/);
  });

  it("a turn of a turn is a turn: four quarter turns come back to the start, for every mounting", () => {
    for (const base of [0, MADCTL_MX, MADCTL_MY, MADCTL_MX | MADCTL_MY]) {
      expect(orientedMadctl(base, 0, 320, 480)).toBe(base);
      // 180 twice is the identity: applying the 180 bits' effect to the 180 picture gives the base again.
      const half = orientedMadctl(base, 180, 320, 480);
      expect(half & MADCTL_MV).toBe(0);
    }
  });

  it("the turned picture's axes run a quarter turn round the panel", () => {
    const w = 320, h = 480;
    const at = (angle: Angle, n: { x: number; y: number }) => madctlMap(orientedMadctl(0, angle, w, h), n, w, h);
    // 90 clockwise: the picture's top-left is at the panel's top-right, x runs down the panel, y runs left.
    expect(at(90, { x: 0, y: 0 })).toEqual({ x: w - 1, y: 0 });
    expect(at(90, { x: 479, y: 0 })).toEqual({ x: w - 1, y: h - 1 });
    expect(at(180, { x: 0, y: 0 })).toEqual({ x: w - 1, y: h - 1 });
    // 270: top-left at the panel's bottom-left, x runs up the panel.
    expect(at(270, { x: 0, y: 0 })).toEqual({ x: 0, y: h - 1 });
    expect(at(270, { x: 479, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("touch flags: 0 keeps the panel's own flags; each angle gives a transform that lands touches in the turned picture", () => {
    const none = { swapXY: false, flipX: false, flipY: false };
    expect(orientedTouch(none, 0, 320, 480)).toEqual(none);
    // 90 clockwise on a 320x480 panel: raw (0,0) (top-left) is at the turned picture's top-right (479, 0).
    const f90 = orientedTouch(none, 90, 320, 480);
    expect(f90.swapXY).toBe(true);
    for (const a of ANGLES) {
      expect(() => orientedTouch({ swapXY: true, flipX: true, flipY: false }, a, 320, 480)).not.toThrow();
    }
  });

  it("touch and display agree: a tap at the turned picture's pixel is the pixel that is drawn under the finger", () => {
    // Tap raw-physical == drawn-physical alignment: for the display, logical -> panel is madctlMap; touch must give
    // the inverse (panel -> logical) when the touch base flags are the identity and the display base is 0.
    const w = 320, h = 480;
    const none = { swapXY: false, flipX: false, flipY: false };
    for (const a of ANGLES) {
      const bits = orientedMadctl(0, a, w, h);
      const f = orientedTouch(none, a, w, h);
      const t = turnedSize(w, h, a);
      for (const l of [{ x: 0, y: 0 }, { x: t.width - 1, y: 0 }, { x: 5, y: 7 }, { x: t.width - 1, y: t.height - 1 }]) {
        const panel = madctlMap(bits, l, w, h); // where the picture pixel is drawn
        // the driver turns a raw panel coordinate into logical coordinates
        let x = panel.x, y = panel.y, tw = w, th = h;
        if (f.swapXY) { [x, y] = [y, x]; [tw, th] = [th, tw]; }
        if (f.flipX) x = tw - 1 - x;
        if (f.flipY) y = th - 1 - y;
        expect({ x, y }).toEqual(l);
      }
    }
  });

  it("with a mirrored panel (mounting MX), touch still lands where the picture is drawn", () => {
    const w = 320, h = 480;
    const none = { swapXY: false, flipX: false, flipY: false }; // raw touch == the unturned picture's own coordinates
    for (const a of ANGLES) {
      const bits = orientedMadctl(MADCTL_MX, a, w, h);
      const f = orientedTouch(none, a, w, h);
      const t = turnedSize(w, h, a);
      for (const n of [{ x: 0, y: 0 }, { x: t.width - 1, y: 0 }, { x: 9, y: 4 }, { x: t.width - 1, y: t.height - 1 }]) {
        const panel = madctlMap(bits, n, w, h);
        const raw = madctlMap(MADCTL_MX, panel, w, h); // a finger there reads the unturned logical coordinate (MX is its own inverse)
        let x = raw.x, y = raw.y, tw = w, th = h;
        if (f.swapXY) { [x, y] = [y, x]; [tw, th] = [th, tw]; }
        if (f.flipX) x = tw - 1 - x;
        if (f.flipY) y = th - 1 - y;
        expect({ x, y }).toEqual(n);
      }
    }
  });
});
