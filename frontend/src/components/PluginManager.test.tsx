// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FoldSection } from "./PluginManager";

afterEach(cleanup);

const KEY = "noteral.plugins.collapsedSections";

describe("FoldSection", () => {
  it("folds and remembers it for the next page", () => {
    const view = render(<FoldSection id="perm-test" title="Permissions">body</FoldSection>);
    const toggle = screen.getByRole("button", { name: /permissions/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("body")).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("body")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "[]")).toContain("perm-test");

    view.unmount();
    render(<FoldSection id="perm-test" title="Permissions">body</FoldSection>);
    expect(screen.queryByText("body")).toBeNull();
  });

  it("starts folded when asked and remembers being opened", () => {
    const view = render(<FoldSection id="details-test" title="Details" defaultCollapsed>facts</FoldSection>);
    expect(screen.queryByText("facts")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    expect(screen.getByText("facts")).toBeTruthy();
    view.unmount();
    render(<FoldSection id="details-test" title="Details" defaultCollapsed>facts</FoldSection>);
    expect(screen.getByText("facts")).toBeTruthy();
  });

  it("keeps header actions out of the toggle", () => {
    let clicks = 0;
    render(
      <FoldSection id="settings-test" title="Settings" actions={<button type="button" onClick={() => clicks++}>Full settings page</button>}>
        options
      </FoldSection>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Full settings page" }));
    expect(clicks).toBe(1);
    expect(screen.getByText("options")).toBeTruthy();
  });
});
