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
    vi.unstubAllEnvs();
  });

  it("listTasks asks for one particular day, not every task ever", async () => {
    const tasks = await api.listTasks("fam_1", "2026-09-23");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/families/fam_1/tasks?date=2026-09-23"),
      expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "application/json" }) })
    );
    expect(tasks).toEqual([{ taskId: "t1", title: "Pack bag" }]);
  });

  it("createTask POSTs a JSON-encoded body", async () => {
    await api.createTask("fam_1", { title: "Buy milk" }, "2026-09-23");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/families/fam_1/tasks"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "Buy milk" }) })
    );
  });

  it("completeTask says which day it's talking about", async () => {
    await api.completeTask("fam_1", "t1", "2026-09-23");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/families/fam_1/tasks/t1"),
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ status: "done", date: "2026-09-23" }) })
    );
  });

  it("reopenTask un-ticks that same day rather than the chore for good", async () => {
    await api.reopenTask("fam_1", "t1", "2026-09-23");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/families/fam_1/tasks/t1"),
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ status: "pending", date: "2026-09-23" }) })
    );
  });

  it("listStatedPreferences calls the family's stated-preferences endpoint", async () => {
    await api.listStatedPreferences("fam_1");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/families/fam_1/stated-preferences"),
      expect.anything()
    );
  });

  it("addStatedPreference POSTs the member id, category, and statement", async () => {
    await api.addStatedPreference("fam_1", { memberId: "member_1", category: "meal", statement: "Prefers penne" });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/families/fam_1/stated-preferences"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ memberId: "member_1", category: "meal", statement: "Prefers penne" }),
      })
    );
  });

  it("removeStatedPreference DELETEs with the memberId as a query param", async () => {
    await api.removeStatedPreference("fam_1", "p1", "member_1");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/families/fam_1/stated-preferences/p1?memberId=member_1"),
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("sends an Authorization header when VITE_FAMILY_API_KEY is set", async () => {
    vi.stubEnv("VITE_FAMILY_API_KEY", "fk_test_key");

    await api.listTasks("fam_1", "2026-09-23");

    expect(fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer fk_test_key" }) })
    );
  });

  it("omits the Authorization header when VITE_FAMILY_API_KEY is unset", async () => {
    vi.stubEnv("VITE_FAMILY_API_KEY", "");

    await api.listTasks("fam_1", "2026-09-23");

    const headers = (vi.mocked(fetch).mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect("Authorization" in headers).toBe(false);
  });

  it("throws with the status code when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    );

    await expect(api.listTasks("fam_1", "2026-09-23")).rejects.toThrow(/500/);
  });
});
