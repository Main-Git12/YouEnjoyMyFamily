import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchMenuMonth, monthsBetween, monthOf, MenuFetchError, type MenuFetch } from "./schoolMenu";

const VIOLET = { provider: "myschoolmenus" as const, organizationId: 2230, siteId: 13754, menuId: 117559 };

/** Builds the provider's shape: JSON whose `setting` is itself a JSON string. */
const day = (date: string, display: unknown[]): unknown => ({
  id: 1,
  day: date,
  meal_id: 2,
  setting: JSON.stringify({ current_display: display, days_off: [], hidden_items: [] }),
});

const category = (name: string) => ({ item: name, weight: 0, name, type: "category" });
const recipe = (name: string) => ({ item: 1, weight: 1, name, type: "recipe" });

function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}): MenuFetch {
  return async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

test("monthOf and monthsBetween work on strings, with no Date in the way", () => {
  assert.equal(monthOf("2026-09-28"), "2026-09");
  assert.deepEqual(monthsBetween("2026-09-28", "2026-10-09"), ["2026-09", "2026-10"]);
  assert.deepEqual(monthsBetween("2026-09-01", "2026-09-30"), ["2026-09"]);
  assert.deepEqual(monthsBetween("2026-11-20", "2027-02-03"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  // A backwards range is a caller's mistake, not a year of months.
  assert.deepEqual(monthsBetween("2026-10-09", "2026-09-28"), []);
});

test("groups a day the way the school published it, in order", async () => {
  const fetchImpl = stubFetch({
    data: [
      day("2026-10-08", [
        category("Lunch Entree"),
        recipe("Chicken Nuggets"),
        recipe("Beef Hot Dog  on Bun"),
        category("Vegetables"),
        recipe("Deli Roasters"),
        category("Fruit"),
        recipe("Fresh Apple"),
      ]),
    ],
  });

  const { days, closed, unreadable } = await fetchMenuMonth(VIOLET, "2026-10", fetchImpl);

  assert.equal(closed, 0);
  assert.equal(unreadable, 0);
  assert.deepEqual(days, [
    {
      date: "2026-10-08",
      groups: [
        { heading: "Lunch Entree", items: ["Chicken Nuggets", "Beef Hot Dog  on Bun"] },
        { heading: "Vegetables", items: ["Deli Roasters"] },
        { heading: "Fruit", items: ["Fresh Apple"] },
      ],
    },
  ]);
});

/**
 * The distinction that matters. Labor Day and fall break are published as
 * days with an empty display, and an early version of this counted them as
 * parse failures — which made the failure count useless for noticing a real
 * one. A closed day is not a broken day.
 */
test("a published day with nothing on it counts as closed, not as a failure", async () => {
  const fetchImpl = stubFetch({
    data: [day("2026-09-07", []), day("2026-09-08", [category("Lunch Entree"), recipe("Walking Taco")])],
  });

  const { days, closed, unreadable } = await fetchMenuMonth(VIOLET, "2026-09", fetchImpl);

  assert.equal(closed, 1);
  assert.equal(unreadable, 0);
  assert.deepEqual(days.map((d) => d.date), ["2026-09-08"]);
});

test("a day whose shape has changed counts as unreadable and is not shown", async () => {
  const fetchImpl = stubFetch({
    data: [
      { id: 1, day: "2026-10-01", meal_id: 2, setting: "this is not json" },
      { id: 2, day: "2026-10-02", meal_id: 2, setting: JSON.stringify({ current_display: "not a list" }) },
      { id: 3, meal_id: 2, setting: JSON.stringify({ current_display: [] }) },
      day("2026-10-05", [category("Lunch Entree"), recipe("Pizza Crunchers")]),
    ],
  });

  const { days, closed, unreadable } = await fetchMenuMonth(VIOLET, "2026-10", fetchImpl);

  assert.equal(unreadable, 3);
  assert.equal(closed, 0);
  assert.deepEqual(days.map((d) => d.date), ["2026-10-05"]);
});

test("items listed before any heading are kept, under no heading rather than an invented one", async () => {
  const fetchImpl = stubFetch({
    data: [day("2026-10-01", [recipe("Walking Taco"), category("Fruit"), recipe("Fresh Fruit")])],
  });

  const { days } = await fetchMenuMonth(VIOLET, "2026-10", fetchImpl);

  assert.deepEqual(days[0]?.groups, [
    { heading: null, items: ["Walking Taco"] },
    { heading: "Fruit", items: ["Fresh Fruit"] },
  ]);
});

test("a heading with nothing under it is dropped", async () => {
  const fetchImpl = stubFetch({
    data: [day("2026-10-01", [category("Lunch Entree"), recipe("Walking Taco"), category("Condiments")])],
  });

  const { days } = await fetchMenuMonth(VIOLET, "2026-10", fetchImpl);

  assert.deepEqual(days[0]?.groups.map((g) => g.heading), ["Lunch Entree"]);
});

test("days come back in date order however the provider sent them", async () => {
  const fetchImpl = stubFetch({
    data: [
      day("2026-10-08", [category("Lunch Entree"), recipe("Chicken Nuggets")]),
      day("2026-10-01", [category("Lunch Entree"), recipe("Walking Taco")]),
    ],
  });

  const { days } = await fetchMenuMonth(VIOLET, "2026-10", fetchImpl);
  assert.deepEqual(days.map((d) => d.date), ["2026-10-01", "2026-10-08"]);
});

test("the request goes to the menu named by the three ids, and nowhere else", async () => {
  const urls: string[] = [];
  const fetchImpl: MenuFetch = async (url) => {
    urls.push(url);
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) };
  };

  await fetchMenuMonth(VIOLET, "2026-09", fetchImpl);

  assert.deepEqual(urls, [
    "https://menus.healthepro.com/api/organizations/2230/menus/117559/year/2026/month/9/date_overwrites",
  ]);
});

test("an upstream error is raised rather than returned as an empty menu", async () => {
  await assert.rejects(
    () => fetchMenuMonth(VIOLET, "2026-10", stubFetch({}, { ok: false, status: 503 })),
    (err: unknown) => err instanceof MenuFetchError && /503/.test((err as Error).message)
  );
});

test("a response that is not JSON, or not the expected shape, is an error not a blank day", async () => {
  await assert.rejects(
    () => fetchMenuMonth(VIOLET, "2026-10", stubFetch("<html>maintenance</html>")),
    MenuFetchError
  );
  await assert.rejects(() => fetchMenuMonth(VIOLET, "2026-10", stubFetch({ nope: true })), MenuFetchError);
});

test("a network failure is wrapped rather than escaping as whatever fetch threw", async () => {
  const fetchImpl: MenuFetch = async () => {
    throw new Error("ECONNRESET");
  };
  await assert.rejects(() => fetchMenuMonth(VIOLET, "2026-10", fetchImpl), MenuFetchError);
});

test("a malformed month is refused before anything is fetched", async () => {
  let called = false;
  const fetchImpl: MenuFetch = async () => {
    called = true;
    return { ok: true, status: 200, text: async () => "{}" };
  };
  await assert.rejects(() => fetchMenuMonth(VIOLET, "2026-13", fetchImpl), MenuFetchError);
  await assert.rejects(() => fetchMenuMonth(VIOLET, "October", fetchImpl), MenuFetchError);
  assert.equal(called, false);
});
