import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

describe("GroceryCart", () => {
  it("shows a calm empty state when the cart is empty", () => {
    render(
      <GroceryCart items={[]} onAdd={vi.fn()} onMarkUnavailable={vi.fn()} onConfirmSubstitute={vi.fn()} onCheckout={vi.fn()} />
    );
    expect(screen.getByText(/nothing in the cart yet/i)).toBeInTheDocument();
  });

  it("renders each item's description, quantity, and a meal-plan tag when applicable", () => {
    const items: CartItem[] = [
      pendingItem,
      { itemId: "i2", description: "Tortillas", quantity: 3, status: "pending", substituteDescription: null, source: "meal_plan" },
    ];
    render(
      <GroceryCart items={items} onAdd={vi.fn()} onMarkUnavailable={vi.fn()} onConfirmSubstitute={vi.fn()} onCheckout={vi.fn()} />
    );

    expect(screen.getByText("Spaghetti")).toBeInTheDocument();
    expect(screen.getByText("Tortillas")).toBeInTheDocument();
    expect(screen.getByText("×3")).toBeInTheDocument();
    expect(screen.getByText("from meal plan")).toBeInTheDocument();
  });

  it("adds a new item and clears the input", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(
      <GroceryCart items={[]} onAdd={onAdd} onMarkUnavailable={vi.fn()} onConfirmSubstitute={vi.fn()} onCheckout={vi.fn()} />
    );

    fireEvent.change(screen.getByPlaceholderText("Add an item"), { target: { value: "Milk" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    expect(onAdd).toHaveBeenCalledWith("Milk");
    await waitFor(() => expect(screen.getByPlaceholderText("Add an item")).toHaveValue(""));
  });

  it("marking an item unavailable shows a suggested substitute to confirm", async () => {
    const onMarkUnavailable = vi.fn().mockResolvedValue("Penne");
    const onConfirmSubstitute = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <GroceryCart
        items={[pendingItem]}
        onAdd={vi.fn()}
        onMarkUnavailable={onMarkUnavailable}
        onConfirmSubstitute={onConfirmSubstitute}
        onCheckout={vi.fn()}
      />
    );

    fireEvent.click(screen.getByLabelText('Mark "Spaghetti" unavailable'));
    await waitFor(() => expect(onMarkUnavailable).toHaveBeenCalledWith(pendingItem));
    await waitFor(() => expect(screen.getByText(/last time: penne/i)).toBeInTheDocument());

    // Simulate the parent (Dashboard) re-rendering with the item's updated
    // status, the way it really flows once markCartItemUnavailable resolves.
    const unavailableItem: CartItem = { ...pendingItem, status: "unavailable" };
    rerender(
      <GroceryCart
        items={[unavailableItem]}
        onAdd={vi.fn()}
        onMarkUnavailable={onMarkUnavailable}
        onConfirmSubstitute={onConfirmSubstitute}
        onCheckout={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(onConfirmSubstitute).toHaveBeenCalledWith(unavailableItem, "Penne"));
  });

  it("checkout shows a link to continue on Instacart", async () => {
    const onCheckout = vi.fn().mockResolvedValue("https://instacart.example/list/abc");
    render(
      <GroceryCart items={[pendingItem]} onAdd={vi.fn()} onMarkUnavailable={vi.fn()} onConfirmSubstitute={vi.fn()} onCheckout={onCheckout} />
    );

    fireEvent.click(screen.getByRole("button", { name: /checkout with instacart/i }));

    await waitFor(() => expect(screen.getByRole("link", { name: /continue on instacart/i })).toHaveAttribute(
      "href",
      "https://instacart.example/list/abc"
    ));
  });

  it("shows an error message when checkout fails", async () => {
    const onCheckout = vi.fn().mockRejectedValue(new Error("The cart has no shoppable items"));
    render(
      <GroceryCart items={[pendingItem]} onAdd={vi.fn()} onMarkUnavailable={vi.fn()} onConfirmSubstitute={vi.fn()} onCheckout={onCheckout} />
    );

    fireEvent.click(screen.getByRole("button", { name: /checkout with instacart/i }));

    await waitFor(() => expect(screen.getByText("The cart has no shoppable items")).toBeInTheDocument());
  });
});
