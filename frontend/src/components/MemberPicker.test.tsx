import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MemberPicker from "./MemberPicker";

describe("MemberPicker", () => {
  it("stays out of the way before anyone has been named", () => {
    const { container } = render(<MemberPicker members={[]} value="" onChange={vi.fn()} anyoneLabel="Anyone" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("picks a name in one tap", () => {
    const onChange = vi.fn();
    render(<MemberPicker members={["Isla", "Parker"]} value="" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Parker" }));

    expect(onChange).toHaveBeenCalledWith("Parker");
  });

  it("says which name is chosen, for anyone not looking at the colour", () => {
    render(<MemberPicker members={["Isla", "Parker"]} value="Parker" onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Parker" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Isla" })).toHaveAttribute("aria-pressed", "false");
  });

  it("offers a way back to nobody in particular, when the field allows it", () => {
    const onChange = vi.fn();
    render(<MemberPicker members={["Parker"]} value="Parker" onChange={onChange} anyoneLabel="Anyone" />);

    fireEvent.click(screen.getByRole("button", { name: "Anyone" }));

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("offers no such way out when the field needs a name", () => {
    render(<MemberPicker members={["Parker"]} value="" onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Anyone" })).not.toBeInTheDocument();
  });
});
