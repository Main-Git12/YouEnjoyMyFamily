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

  it("explains a failure in words a family can read, and keeps the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    );

    await expect(api.listTasks("fam_1", "2026-09-23")).rejects.toThrow(/having a moment/i);
    await expect(api.listTasks("fam_1", "2026-09-23")).rejects.toMatchObject({ status: 500 });
  });

  it("says the screen is signed out on a 401, rather than blaming the network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 401 }))
    );

    await expect(api.listTasks("fam_1", "2026-09-23")).rejects.toThrow(/isn't signed in/i);
  });

  it("retries once on a server blip, and gives the good answer", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? new Response("nope", { status: 503 })
          : new Response(JSON.stringify([{ taskId: "t1" }]), { status: 200 });
      })
    );

    await expect(api.listTasks("fam_1", "2026-09-23")).resolves.toEqual([{ taskId: "t1" }]);
    expect(calls).toBe(2);
  });

  it("does not retry a refusal, which would say exactly the same thing again", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response("no", { status: 401 });
      })
    );

    await expect(api.listTasks("fam_1", "2026-09-23")).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("never repeats a write on its own, since the first one may already have landed", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response("nope", { status: 503 });
      })
    );

    await expect(api.claimRewardGoal("fam_1", "Parker")).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("explains a 409 as a change on another screen, not a bad request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 409 }))
    );

    await expect(api.claimRewardGoal("fam_1", "Parker")).rejects.toThrow(/changed on another screen/i);
  });

  it("blames the wi-fi when the network itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    await expect(api.listTasks("fam_1", "2026-09-23")).rejects.toThrow(/check the wi-fi/i);
  });
});
