import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App";
import { linkDevice, unlinkDevice } from "./lib/familyKey";
import * as alexaSurface from "./lib/alexaSurface";

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
    // Credentials now also live in memory, so a device can stay linked where
    // storage is disabled (the Echo Show case). Clearing storage alone no
    // longer makes a screen fresh — unlinkDevice does, which is what a
    // genuinely new device looks like.
    unlinkDevice();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
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

describe("App, opened by the skill on an Echo Show", () => {
  beforeEach(() => {
    unlinkDevice();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const onEchoShow = () => window.history.replaceState({}, "", "/?surface=echo-show");

  it("doesn't flash the linking form while the skill is still handing over", async () => {
    // On a wall screen, asking "which family is this?" and then withdrawing
    // the question a moment later reads as an app changing its mind.
    onEchoShow();
    vi.spyOn(alexaSurface, "linkFromAlexa").mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    render(<App />);

    expect(screen.getByText(/opening your family screen/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect this screen/i })).not.toBeInTheDocument();
  });

  it("goes straight to the day once the skill has handed the key over", async () => {
    onEchoShow();
    vi.spyOn(alexaSurface, "linkFromAlexa").mockImplementation(async () => {
      linkDevice("fam_1", "fk_from_skill");
      return "linked";
    });

    render(<App />);

    expect(await screen.findByText("The family's day")).toBeInTheDocument();
  });

  it("asks for the key when the skill deliberately withheld it", async () => {
    // Autolink off. The screen knows the family but still has to ask.
    onEchoShow();
    vi.spyOn(alexaSurface, "linkFromAlexa").mockResolvedValue("partial");

    render(<App />);

    expect(await screen.findByRole("button", { name: /connect this screen/i })).toBeInTheDocument();
  });

  it("falls back to the linking form when the handshake never works", async () => {
    onEchoShow();
    vi.spyOn(alexaSurface, "linkFromAlexa").mockResolvedValue("unavailable");

    render(<App />);

    expect(await screen.findByRole("button", { name: /connect this screen/i })).toBeInTheDocument();
  });

  it("never waits on Alexa anywhere but an Echo Show", () => {
    // A phone must not sit on a loading screen for a handshake that is never
    // going to happen.
    const spy = vi.spyOn(alexaSurface, "linkFromAlexa");

    render(<App />);

    expect(screen.getByRole("button", { name: /connect this screen/i })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("doesn't wait on Alexa for a screen that is already linked", () => {
    onEchoShow();
    linkDevice("fam_1", "fk_already");
    const spy = vi.spyOn(alexaSurface, "linkFromAlexa");

    render(<App />);

    expect(screen.getByText("The family's day")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});
