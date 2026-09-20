import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import GroceryCart from "./GroceryCart";
import type { CartItem } from "../types";

const pendingItem: CartItem = {
  itemId: "i1",
  description: "Spaghetti",
  quantity: 1,
  status: "pending",
  substituteDescription: null,
  source: "manual",
};

type CartProps = Parameters<typeof GroceryCart>[0];

function cartProps(overrides: Partial<CartProps> = {}): CartProps {
  return {
    items: [],
    onAdd: vi.fn(),
    onMarkUnavailable: vi.fn(),
    onConfirmSubstitute: vi.fn(),
    onRemove: vi.fn(),
    onCheckout: vi.fn(),
    ...overrides,
  };
}

describe("GroceryCart", () => {
  it("shows a calm empty state when the cart is empty", () => {
    render(<GroceryCart {...cartProps()} />);
    expect(screen.getByText(/nothing in the cart yet/i)).toBeInTheDocument();
  });

  it("renders each item's description, quantity, and a meal-plan tag when applicable", () => {
    const items: CartItem[] = [
      pendingItem,
      { itemId: "i2", description: "Tortillas", quantity: 3, status: "pending", substituteDescription: null, source: "meal_plan" },
    ];
    render(<GroceryCart {...cartProps({ items })} />);

    expect(screen.getByText("Spaghetti")).toBeInTheDocument();
    expect(screen.getByText("Tortillas")).toBeInTheDocument();
    expect(screen.getByText("from meal plan")).toBeInTheDocument();
    // A meal-plan quantity counts meals, not packets — "×3" in an aisle
    // would have someone buy three packs.
    expect(screen.getByText(/for 3 meals/)).toBeInTheDocument();
    expect(screen.queryByText("×3")).not.toBeInTheDocument();
  });

  it("shows a hand-entered quantity as a plain multiplier", () => {
    const items: CartItem[] = [{ ...pendingItem, description: "Milk", quantity: 2, source: "manual" }];
    render(<GroceryCart {...cartProps({ items })} />);

    expect(screen.getByText("×2")).toBeInTheDocument();
    expect(screen.queryByText(/for 2 meals/)).not.toBeInTheDocument();
  });

  it("adds a new item with the entered quantity, then resets the form", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<GroceryCart {...cartProps({ onAdd })} />);

    fireEvent.change(screen.getByPlaceholderText("Add an item"), { target: { value: "Milk" } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    expect(onAdd).toHaveBeenCalledWith("Milk", 3);
    await waitFor(() => expect(screen.getByPlaceholderText("Add an item")).toHaveValue(""));
    expect(screen.getByLabelText("Quantity")).toHaveValue(1);
  });

  it("falls back to a quantity of 1 when the quantity field is blank or nonsense", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<GroceryCart {...cartProps({ onAdd })} />);

    fireEvent.change(screen.getByPlaceholderText("Add an item"), { target: { value: "Milk" } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    expect(onAdd).toHaveBeenCalledWith("Milk", 1);
    // Wait out the post-submit form reset so the state update lands inside act().
    await waitFor(() => expect(screen.getByPlaceholderText("Add an item")).toHaveValue(""));
  });

  it("removes an item only after a second, deliberate tap", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(<GroceryCart {...cartProps({ items: [pendingItem], onRemove })} />);

    // One stray tap — from a passing child, say — must not delete anything.
    fireEvent.click(screen.getByLabelText('Remove "Spaghetti" from the cart'));
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Tap again to remove "Spaghetti" from the cart'));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(pendingItem));
  });

  it("forgets a half-finished removal, so it can't catch the next person out", async () => {
    vi.useFakeTimers();
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(<GroceryCart {...cartProps({ items: [pendingItem], onRemove })} />);

    fireEvent.click(screen.getByLabelText('Remove "Spaghetti" from the cart'));
    expect(screen.getByText("Tap again")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByText("Remove")).toBeInTheDocument();
    expect(onRemove).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("can remove an item that was already marked unavailable, so it doesn't linger forever", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    const unavailableItem: CartItem = { ...pendingItem, status: "unavailable" };
    render(<GroceryCart {...cartProps({ items: [unavailableItem], onRemove })} />);

    // "Can't find it" is gone once it's unavailable, but Remove still isn't.
    expect(screen.queryByLabelText('Mark "Spaghetti" unavailable')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Remove "Spaghetti" from the cart'));
    fireEvent.click(screen.getByLabelText('Tap again to remove "Spaghetti" from the cart'));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(unavailableItem));
  });

  it("marking an item unavailable shows a suggested substitute to confirm", async () => {
    const onMarkUnavailable = vi.fn().mockResolvedValue("Penne");
    const onConfirmSubstitute = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <GroceryCart {...cartProps({ items: [pendingItem], onMarkUnavailable, onConfirmSubstitute })} />
    );

    fireEvent.click(screen.getByLabelText('Mark "Spaghetti" unavailable'));
    await waitFor(() => expect(onMarkUnavailable).toHaveBeenCalledWith(pendingItem));
    await waitFor(() => expect(screen.getByText(/last time: penne/i)).toBeInTheDocument());

    // Simulate the parent (Dashboard) re-rendering with the item's updated
    // status, the way it really flows once markCartItemUnavailable resolves.
    const unavailableItem: CartItem = { ...pendingItem, status: "unavailable" };
    rerender(<GroceryCart {...cartProps({ items: [unavailableItem], onMarkUnavailable, onConfirmSubstitute })} />);

    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(onConfirmSubstitute).toHaveBeenCalledWith(unavailableItem, "Penne"));
  });

  it("checkout shows a link to continue on Instacart", async () => {
    const onCheckout = vi.fn().mockResolvedValue("https://instacart.example/list/abc");
    render(<GroceryCart {...cartProps({ items: [pendingItem], onCheckout })} />);

    fireEvent.click(screen.getByRole("button", { name: /checkout with instacart/i }));

    await waitFor(() =>
      expect(screen.getByRole("link", { name: /continue on instacart/i })).toHaveAttribute(
        "href",
        "https://instacart.example/list/abc"
      )
    );
  });

  it("keeps the checkout link when a sync re-sends an identical cart", async () => {
    const onCheckout = vi.fn().mockResolvedValue("https://instacart.example/list/abc");
    const { rerender } = render(<GroceryCart {...cartProps({ items: [pendingItem], onCheckout })} />);

    fireEvent.click(screen.getByRole("button", { name: /checkout with instacart/i }));
    await waitFor(() => expect(screen.getByRole("link", { name: /continue on instacart/i })).toBeInTheDocument());

    // The 30s sync hands down a fresh array with identical contents. The link
    // must survive — otherwise it vanishes on the way to the shop.
    rerender(<GroceryCart {...cartProps({ items: [{ ...pendingItem }], onCheckout })} />);
    expect(screen.getByRole("link", { name: /continue on instacart/i })).toBeInTheDocument();

    // A cart that actually changed does invalidate it.
    rerender(<GroceryCart {...cartProps({ items: [{ ...pendingItem, quantity: 5 }], onCheckout })} />);
    expect(screen.queryByRole("link", { name: /continue on instacart/i })).not.toBeInTheDocument();
  });

  it("disables checkout when there's nothing shoppable, rather than letting it fail server-side", () => {
    const { rerender } = render(<GroceryCart {...cartProps({ items: [] })} />);
    expect(screen.getByRole("button", { name: /checkout with instacart/i })).toBeDisabled();

    rerender(<GroceryCart {...cartProps({ items: [{ ...pendingItem, status: "unavailable" }] })} />);
    expect(screen.getByRole("button", { name: /checkout with instacart/i })).toBeDisabled();

    rerender(<GroceryCart {...cartProps({ items: [pendingItem] })} />);
    expect(screen.getByRole("button", { name: /checkout with instacart/i })).toBeEnabled();
  });

  it("shows an error message when checkout fails", async () => {
    const onCheckout = vi.fn().mockRejectedValue(new Error("The cart has no shoppable items"));
    render(<GroceryCart {...cartProps({ items: [pendingItem], onCheckout })} />);

    fireEvent.click(screen.getByRole("button", { name: /checkout with instacart/i }));

    await waitFor(() => expect(screen.getByText("The cart has no shoppable items")).toBeInTheDocument());
  });
});
