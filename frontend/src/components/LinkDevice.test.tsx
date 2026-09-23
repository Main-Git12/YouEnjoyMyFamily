import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LinkDevice from "./LinkDevice";

describe("LinkDevice", () => {
  it("asks for the family and the key, once", () => {
    render(<LinkDevice onLink={vi.fn()} />);

    expect(screen.getByText(/only do this once per device/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/family id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/family key/i)).toBeInTheDocument();
  });

  it("keeps the key off the wall while it's being typed", () => {
    render(<LinkDevice onLink={vi.fn()} />);
    expect(screen.getByLabelText(/family key/i)).toHaveAttribute("type", "password");
  });

  it("won't connect on half the details", () => {
    render(<LinkDevice onLink={vi.fn()} />);
    const connect = screen.getByRole("button", { name: /connect this screen/i });

    expect(connect).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/family id/i), { target: { value: "fam_123" } });
    expect(connect).toBeDisabled();
  });

  it("links the screen with what was pasted", () => {
    const onLink = vi.fn();
    render(<LinkDevice onLink={onLink} />);

    fireEvent.change(screen.getByLabelText(/family id/i), { target: { value: "  fam_123  " } });
    fireEvent.change(screen.getByLabelText(/family key/i), { target: { value: "  fk_secret  " } });
    fireEvent.click(screen.getByRole("button", { name: /connect this screen/i }));

    expect(onLink).toHaveBeenCalledWith("fam_123", "fk_secret");
  });

  it("explains itself differently when a working key stopped working", () => {
    render(<LinkDevice onLink={vi.fn()} signedOut />);

    expect(screen.getByRole("alert")).toHaveTextContent(/isn't signed in/i);
    expect(screen.queryByText(/only do this once per device/i)).not.toBeInTheDocument();
  });
});
