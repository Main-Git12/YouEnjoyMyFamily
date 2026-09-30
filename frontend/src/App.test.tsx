import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App";
import { linkDevice } from "./lib/familyKey";

vi.mock("./components/Dashboard", () => ({
  default: ({ onSignedOut }: { onSignedOut?: () => void }) => (
    <div>
      <p>The family&apos;s day</p>
      <button type="button" onClick={() => onSignedOut?.()}>
        pretend the key was rejected
      </button>
    </div>
  ),
}));

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllEnvs();
  });

  it("asks a brand-new screen which family it belongs to", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: /connect this screen/i })).toBeInTheDocument();
    expect(screen.queryByText("The family's day")).not.toBeInTheDocument();
  });

  it("goes straight to the day on a screen that's already linked", () => {
    linkDevice("fam_123", "fk_secret");
    render(<App />);

    expect(screen.getByText("The family's day")).toBeInTheDocument();
  });

  it("shows the day as soon as a screen is connected, without a reload", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText(/family id/i), { target: { value: "fam_123" } });
    fireEvent.change(screen.getByLabelText(/family key/i), { target: { value: "fk_secret" } });
    fireEvent.click(screen.getByRole("button", { name: /connect this screen/i }));

    await waitFor(() => expect(screen.getByText("The family's day")).toBeInTheDocument());
  });

  it("sends a screen back to setup when its key stops being accepted", async () => {
    linkDevice("fam_123", "fk_secret");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /pretend the key was rejected/i }));

    // A revoked key can't be retried out of, so looping on a banner would
    // leave the screen stuck for good.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/isn't signed in/i));
    // And the dead key is forgotten rather than left on the device.
    expect(window.localStorage.getItem("yemf.familyApiKey")).toBeNull();
  });
});
