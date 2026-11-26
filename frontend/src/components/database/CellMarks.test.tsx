// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NumberDisplay, NumberFormat, Property } from "../../lib/database";
import { CheckboxMark, CheckboxToggle, NumberValue } from "./CellMarks";

afterEach(cleanup);

const numberProperty = (display?: NumberDisplay, format?: NumberFormat): Property => ({ id: "p1", name: "Progress", type: "number", ...(format ? { format } : {}), ...(display ? { display } : {}) });

describe("CheckboxMark", () => {
  it("labels its state", () => {
    const { rerender } = render(<CheckboxMark checked={false} />);
    expect(screen.getByRole("img", { name: "Not checked" }).className).not.toContain("is-checked");
    rerender(<CheckboxMark checked label="Done: checked" />);
    expect(screen.getByRole("img", { name: "Done: checked" }).className).toContain("is-checked");
  });

  it("animates only when the value changes", () => {
    const { container, rerender } = render(<CheckboxMark checked />);
    const box = container.querySelector(".db-checkbox")!;
    expect(box.className).not.toContain("is-animating");
    rerender(<CheckboxMark checked={false} />);
    expect(box.className).toContain("is-animating");
    fireEvent.animationEnd(box, { animationName: "db-check-out" });
    expect(box.className).not.toContain("is-animating");
  });

  it("hides from assistive tech when decorative", () => {
    const { container } = render(<CheckboxMark checked decorative />);
    expect(container.querySelector(".db-checkbox")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("CheckboxToggle", () => {
  it("toggles without reaching the card", () => {
    const onToggle = vi.fn();
    const onCard = vi.fn();
    render(
      <div onClick={onCard}>
        <CheckboxToggle checked={false} name="Done" showName onToggle={onToggle} />
      </div>,
    );
    const toggle = screen.getByRole("checkbox", { name: "Done" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.textContent).toBe("Done");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onCard).not.toHaveBeenCalled();
  });
});

describe("NumberValue", () => {
  it("shows a plain formatted number by default", () => {
    const { container } = render(<NumberValue property={numberProperty(undefined, "commas")} value={12345} />);
    expect(container.querySelector(".db-number")?.textContent).toBe("12,345");
    expect(screen.queryByRole("meter")).toBeNull();
  });

  it("renders nothing for an empty value", () => {
    const { container } = render(<NumberValue property={numberProperty({ style: "bar" })} value={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("draws a clamped bar with the number", () => {
    const { container, rerender } = render(<NumberValue property={numberProperty({ style: "bar", color: "green" })} value={42} />);
    const meter = screen.getByRole("meter", { name: "Progress" });
    expect(meter.className).toContain("tone-green");
    expect(meter.getAttribute("aria-valuetext")).toBe("42 of 100");
    expect((container.querySelector(".db-bar-fill") as HTMLElement).style.width).toBe("42%");
    expect(container.querySelector(".db-viz-number")?.textContent).toBe("42");
    rerender(<NumberValue property={numberProperty({ style: "bar", showNumber: false })} value={140} />);
    expect((container.querySelector(".db-bar-fill") as HTMLElement).style.width).toBe("100%");
    expect(container.querySelector(".db-viz-number")).toBeNull();
  });

  it("uses 1 as full for percents", () => {
    const { container } = render(<NumberValue property={numberProperty({ style: "ring" }, "percent")} value={0.25} />);
    expect(screen.getByRole("meter").getAttribute("aria-valuetext")).toBe("25% of 100%");
    const fill = container.querySelector(".db-ring-fill")!;
    const [dash, total] = fill.getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(dash / total).toBeCloseTo(0.25, 2);
  });

  it("leaves an empty ring at zero", () => {
    const { container } = render(<NumberValue property={numberProperty({ style: "ring" })} value={0} />);
    expect(container.querySelector(".db-ring-track")).not.toBeNull();
    expect(container.querySelector(".db-ring-fill")).toBeNull();
  });

  it("fills rating stars to the nearest half", () => {
    const { container } = render(<NumberValue property={numberProperty({ style: "rating", max: 5 })} value={3.4} />);
    expect(container.querySelectorAll(".db-star")).toHaveLength(5);
    const fills = Array.from(container.querySelectorAll<HTMLElement>(".db-star-fill")).map((item) => item.style.width);
    expect(fills).toEqual(["100%", "100%", "100%", "50%"]);
  });

  it("tints heat by size", () => {
    const { container } = render(<NumberValue property={numberProperty({ style: "heat", max: 10 })} value={5} />);
    const heat = container.querySelector(".db-heat") as HTMLElement;
    expect(heat.textContent).toBe("5");
    expect(heat.style.getPropertyValue("--heat")).toBe("27%");
  });
});
