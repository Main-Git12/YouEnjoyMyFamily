import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error("dueWindow of undefined");
  return <p>The family's day</p>;
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays out of the way when nothing is wrong", () => {
    render(
      <ErrorBoundary>
        <Boom explode={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText("The family's day")).toBeInTheDocument();
  });

  it("shows something a person can read instead of a white screen", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom explode />
      </ErrorBoundary>
    );

    expect(screen.getByText(/tripped over something/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is lost/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload the screen/i })).toBeInTheDocument();
  });

  it("gives a way back, since there's no obvious reload on a kitchen display", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    Object.defineProperty(window, "location", { value: { reload }, writable: true });

    render(
      <ErrorBoundary>
        <Boom explode />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole("button", { name: /reload the screen/i }));

    expect(reload).toHaveBeenCalled();
  });

  it("logs the failure to the console, and nowhere off the device", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom explode />
      </ErrorBoundary>
    );

    expect(consoleError).toHaveBeenCalled();
  });
});
