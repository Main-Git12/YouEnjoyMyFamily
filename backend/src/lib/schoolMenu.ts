import type { SchoolMenuDay, SchoolMenuGroup, SchoolMenuSourceInput } from "../types";

/**
 * Reads a school's published lunch menu.
 *
 * Many districts publish through MySchoolMenus (Health-e Pro), which serves
 * a month at a time over a public, unauthenticated JSON API — no key, no
 * account, nothing to keep out of the bundle. A menu is identified by three
 * integers (organisation, site, menu), which a family reads out of their own
 * school's menu URL; one lunch menu is often shared across every elementary
 * building in a district.
 *
 * Deliberately no real ids in this file. They name a specific building, and
 * a building plus a child's name is most of what somebody would need to
 * approach that child convincingly. They live in the deployed table.
 *
 * Only the base URL lives here. Which menu to read comes from the family's
 * own `SchoolProfile`, as three integers rather than a URL, so nothing a
 * database row says can send this fetch somewhere else.
 */
const MYSCHOOLMENUS_BASE = "https://menus.healthepro.com/api";

/**
 * The provider hands back `setting` as a JSON *string* inside the JSON, and
 * inside that a `current_display` list that interleaves headings and items:
 *
 *   [{type: "category", name: "Lunch Entree"},
 *    {type: "recipe",   name: "Chicken Nuggets"}, ...]
 *
 * Everything below treats that as untrusted shape. It is somebody else's
 * database, it will change without telling us, and the failure that matters
 * is not a crash — it is a kitchen screen confidently showing Tuesday's
 * lunch as blank. So a day that cannot be parsed is dropped and counted,
 * never rendered as an empty menu.
 */
interface DisplayEntry {
  type?: unknown;
  name?: unknown;
}

/** Only the slice of `fetch` this module uses, so tests need not fake the web. */
export type MenuFetch = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class MenuFetchError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `YYYY-MM` for a date-only string, without going through a Date. */
export const monthOf = (isoDate: string): string => isoDate.slice(0, 7);

/**
 * Every `YYYY-MM` a date range touches, inclusive. String comparison is
 * enough because both ends are `YYYY-MM-DD`, and building it this way keeps
 * a timezone out of a question that has no time in it.
 */
export function monthsBetween(start: string, end: string): string[] {
  if (end < start) return [];
  const months: string[] = [];
  let [year, month] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))];
  const last = monthOf(end);
  for (let guard = 0; guard < 120; guard += 1) {
    const current = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    months.push(current);
    if (current >= last) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/**
 * Returns null when the provider sent something that is not a display list
 * at all — the shape changed, and that is worth knowing about. An *empty*
 * list is a different thing entirely and returns `[]`: see `fetchMenuMonth`.
 */
function parseDisplay(display: unknown): SchoolMenuGroup[] | null {
  if (!Array.isArray(display)) return null;
  const groups: SchoolMenuGroup[] = [];
  let current: SchoolMenuGroup | null = null;

  for (const raw of display as DisplayEntry[]) {
    if (!isRecord(raw)) continue;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) continue;

    if (raw.type === "category") {
      current = { heading: name, items: [] };
      groups.push(current);
      continue;
    }
    if (raw.type !== "recipe") continue;
    if (!current) {
      // Items before any heading. Real in the data, so kept — with a null
      // heading rather than a category name this app made up.
      current = { heading: null, items: [] };
      groups.push(current);
    }
    current.items.push(name);
  }

  // A heading the school left empty is noise on a screen, not information.
  return groups.filter((group) => group.items.length > 0);
}

export interface MenuMonthResult {
  days: SchoolMenuDay[];
  /**
   * Days the provider published with nothing on them. These are ordinary and
   * expected — Labor Day, fall break, a conference day — and they are counted
   * separately from failures precisely so that `unreadable` stays a number
   * worth looking at. Lumping the two together was the first version of this,
   * and it reported three parse errors for a district that had simply closed
   * the school.
   */
  closed: number;
  /**
   * Days that could not be read: a row missing its date, a `setting` that is
   * not JSON, a display list that is no longer a list. Logged, never
   * rendered — a day this app cannot parse must not reach a kitchen screen
   * looking like a day with no lunch.
   */
  unreadable: number;
}

/**
 * One month of one menu. `month` is `YYYY-MM`.
 *
 * Days are whatever the provider published — school days only; weekends and
 * closures simply are not in the response, which is why nothing here tries
 * to fill a calendar grid. A school with no lunch on a Monday and a school
 * that is shut on that Monday look identical from here, and pretending to
 * tell them apart would be making it up.
 */
export async function fetchMenuMonth(
  source: SchoolMenuSourceInput,
  month: string,
  fetchImpl: MenuFetch = fetch
): Promise<MenuMonthResult> {
  if (source.provider !== "myschoolmenus") {
    throw new MenuFetchError(`Unknown menu provider: ${String(source.provider)}`);
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new MenuFetchError(`Month must be YYYY-MM, got ${month}`);
  }

  const [year, monthNumber] = [month.slice(0, 4), Number(month.slice(5, 7))];
  const url =
    `${MYSCHOOLMENUS_BASE}/organizations/${source.organizationId}` +
    `/menus/${source.menuId}/year/${year}/month/${monthNumber}/date_overwrites`;

  let response: Awaited<ReturnType<MenuFetch>>;
  try {
    response = await fetchImpl(url);
  } catch (err) {
    throw new MenuFetchError(`Could not reach the menu provider: ${String(err)}`);
  }
  if (!response.ok) throw new MenuFetchError(`Menu provider returned ${response.status}`);

  let payload: unknown;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new MenuFetchError("Menu provider did not return JSON");
  }

  const rows = isRecord(payload) && Array.isArray(payload.data) ? payload.data : null;
  if (!rows) throw new MenuFetchError("Menu provider returned an unexpected shape");

  const days: SchoolMenuDay[] = [];
  let closed = 0;
  let unreadable = 0;

  for (const row of rows) {
    if (!isRecord(row) || typeof row.day !== "string" || typeof row.setting !== "string") {
      unreadable += 1;
      continue;
    }
    let setting: unknown;
    try {
      setting = JSON.parse(row.setting);
    } catch {
      unreadable += 1;
      continue;
    }
    const groups = parseDisplay(isRecord(setting) ? setting.current_display : null);
    if (groups === null) {
      unreadable += 1;
      continue;
    }
    if (groups.length === 0) {
      // Published, deliberately empty: no school, or no lunch served. Not a
      // day this app should show, and not a day it should complain about.
      closed += 1;
      continue;
    }
    days.push({ date: row.day, groups });
  }

  days.sort((a, b) => a.date.localeCompare(b.date));
  return { days, closed, unreadable };
}
