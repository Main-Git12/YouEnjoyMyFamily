import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useDismissableOverlay } from "./useDismissableOverlay";

function Overlay({ onDismiss, active = true }: { onDismiss: () => void; active?: boolean }) {
  const ref = useDismissableOverlay<HTMLDivElement>(onDismiss, active);
  return (
    <div ref={ref} tabIndex={-1} data-testid="overlay">
      <button type="button">Do the thing</button>
      <button type="button">Not now</button>
    </div>
  );
}

describe("useDismissableOverlay", () => {
  it("puts focus on the first thing you can act on", () => {
    render(<Overlay onDismiss={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Do the thing" })).toHaveFocus();
  });

  it("closes on Escape", () => {
    const onDismiss = vi.fn();
    render(<Overlay onDismiss={onDismiss} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys, so typing isn't a way to dismiss it by accident", () => {
    const onDismiss = vi.fn();
    render(<Overlay onDismiss={onDismiss} />);

    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: "a" });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("gives focus back to whatever opened it", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    expect(opener).toHaveFocus();

    const { unmount } = render(<Overlay onDismiss={vi.fn()} />);
    expect(opener).not.toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("stops listening once it's gone, so Escape doesn't fire into nothing", () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<Overlay onDismiss={onDismiss} />);
    unmount();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does nothing at all while inactive", () => {
    const onDismiss = vi.fn();
    render(<Overlay onDismiss={onDismiss} active={false} />);

    expect(screen.getByRole("button", { name: "Do the thing" })).not.toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
