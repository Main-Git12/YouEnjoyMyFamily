import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./api";

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([{ taskId: "t1", title: "Pack bag" }]), { status: 200 }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listTasks calls the family's tasks endpoint and parses the JSON body", async () => {
    const tasks = await api.listTasks("fam_1");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/families/fam_1/tasks"),
      expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "application/json" }) })
    );
    expect(tasks).toEqual([{ taskId: "t1", title: "Pack bag" }]);
  });

  it("createTask POSTs a JSON-encoded body", async () => {
    await api.createTask("fam_1", { title: "Buy milk" });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/families/fam_1/tasks"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "Buy milk" }) })
    );
  });

  it("throws with the status code when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    );

    await expect(api.listTasks("fam_1")).rejects.toThrow(/500/);
  });
});
