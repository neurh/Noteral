import { describe, expect, it } from "vitest";
import {
  COVER_COLORS,
  COVER_GRADIENTS,
  COVER_IMAGES,
  coverBase,
  coverName,
  coverPositionOf,
  coverStyle,
  customGradientValue,
  isPositionableCover,
  parseCustomGradient,
  withCoverPosition,
} from "./covers";

describe("page covers", () => {
  it("keeps the offline catalog complete and unique", () => {
    expect(COVER_COLORS).toHaveLength(30);
    expect(COVER_GRADIENTS).toHaveLength(22);
    expect(COVER_IMAGES).toHaveLength(20);
    const values = [...COVER_COLORS, ...COVER_GRADIENTS, ...COVER_IMAGES].map((cover) => cover.value);
    expect(new Set(values).size).toBe(values.length);
    expect(COVER_IMAGES.every((cover) => cover.preview.startsWith('url("/covers/') && cover.preview.endsWith('.webp")'))).toBe(true);
  });

  it("resolves safe cover styles and rejects remote uploads", () => {
    expect(coverStyle("color:#b1533d")).toEqual({ backgroundColor: "#b1533d" });
    expect(coverStyle("color:red")).toBeUndefined();
    expect(coverStyle("image:alpine-boat")?.backgroundImage).toContain("/covers/alpine-boat.webp");
    expect(coverStyle("upload:/__assets/ws/assets/one.png")?.backgroundImage).toContain("/__assets/ws/assets/one.png");
    expect(coverStyle("upload:https://example.com/cover.jpg")).toBeUndefined();
    expect(coverName("image:alpine-boat")).toBe("Alpine boat");
    expect(coverName("upload:/__assets/ws/one.png")).toBe("Uploaded image");
  });

  it("builds and reads custom gradients", () => {
    const value = customGradientValue(128, "#F6D5B8", "#BF6B62");
    expect(value).toBe("gradientcustom:128:#f6d5b8:#bf6b62");
    expect(parseCustomGradient(value)).toEqual({ angle: 128, from: "#f6d5b8", to: "#bf6b62" });
    expect(coverStyle(value)?.backgroundImage).toContain("linear-gradient(128deg");
    expect(coverName(value)).toBe("Custom gradient");
    expect(parseCustomGradient("gradientcustom:whatever")).toBeUndefined();
  });

  it("keeps image focal points in the stored value", () => {
    const value = withCoverPosition("image:alpine-boat", 32, 118);
    expect(value).toBe("image:alpine-boat#pos=32,100");
    expect(coverBase(value)).toBe("image:alpine-boat");
    expect(coverPositionOf(value)).toEqual({ x: 32, y: 100 });
    expect(coverStyle(value)?.backgroundPosition).toBe("32% 100%");
    expect(coverName(value)).toBe("Alpine boat");
    expect(withCoverPosition("color:#b1533d", 10, 20)).toBe("color:#b1533d");
    expect(isPositionableCover("image:alpine-boat")).toBe(true);
    expect(isPositionableCover("upload:/__assets/ws/one.png")).toBe(true);
    expect(isPositionableCover("gradient:blue-hour")).toBe(false);
  });
});
