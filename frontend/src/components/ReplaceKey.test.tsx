import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ReplaceKey from "./ReplaceKey";

describe("ReplaceKey", () => {
  it("won't replace anything on a single tap", async () => {
    // It hangs on a kitchen wall. One stray hand must not be able to sign
    // every device in the house out.
    const onReplace = vi.fn();
    render(<ReplaceKey onReplace={onReplace} onKeepOnThisDevice={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /replace the family key/i }));

    expect(onReplace).not.toHaveBeenCalled();
    expect(screen.getByText(/signs out every phone and screen/i)).toBeInTheDocument();
  });

  it("says what will happen before it happens", () => {
    render(<ReplaceKey onReplace={vi.fn()} onKeepOnThisDevice={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /replace the family key/i }));

    expect(screen.getByText(/including the ones that aren't here/i)).toBeInTheDocument();
  });

  it("backs out without calling anything", () => {
    const onReplace = vi.fn();
    render(<ReplaceKey onReplace={onReplace} onKeepOnThisDevice={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /replace the family key/i }));
    fireEvent.click(screen.getByRole("button", { name: /leave it alone/i }));

    expect(onReplace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /replace the family key/i })).toBeInTheDocument();
  });

  it("shows the new key in full, and keeps it on this device", async () => {
    const onKeepOnThisDevice = vi.fn();
    render(
      <ReplaceKey onReplace={async () => "fk_brand_new_key_1234"} onKeepOnThisDevice={onKeepOnThisDevice} />
    );

    fireEvent.click(screen.getByRole("button", { name: /replace the family key/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, replace the key/i }));

    await waitFor(() => expect(screen.getByTestId("new-family-key")).toBeInTheDocument());
    // In full: it has to be typed into every other device, so a truncated
    // or masked version is the same as no key at all.
    expect(screen.getByTestId("new-family-key")).toHaveTextContent("fk_brand_new_key_1234");
    expect(onKeepOnThisDevice).toHaveBeenCalledWith("fk_brand_new_key_1234");
    expect(screen.getByText(/only time it will be shown/i)).toBeInTheDocument();
  });

  it("replaces the key once, however many times the confirm is tapped", async () => {
    const onReplace = vi.fn(async () => "fk_new");
    render(<ReplaceKey onReplace={onReplace} onKeepOnThisDevice={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /replace the family key/i }));
    const confirm = screen.getByRole("button", { name: /yes, replace the key/i });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.getByTestId("new-family-key")).toBeInTheDocument());
    expect(onReplace).toHaveBeenCalledTimes(1);
  });

  it("says plainly that nothing changed when it fails", async () => {
    render(
      <ReplaceKey
        onReplace={async () => {
          throw new Error("409");
        }}
        onKeepOnThisDevice={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /replace the family key/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, replace the key/i }));

    // The one thing the family needs to know: which key still works.
    await waitFor(() => expect(screen.getByText(/the old key still works/i)).toBeInTheDocument());
    expect(screen.queryByTestId("new-family-key")).not.toBeInTheDocument();
  });
});
