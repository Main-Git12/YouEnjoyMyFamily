# YouEnjoyMyFamily frontend

React + Vite + TypeScript dashboard SPA, styled with Tailwind using an
olive/earthy palette (`tailwind.config.js`, `src/theme.css`) tuned for
readability on Echo Show displays: large touch targets, high contrast,
muted colors.

## Structure

```
src/
  App.tsx                  Root — setup screen until the device is linked, then the dashboard
  main.tsx                 Vite entry point
  theme.css                Tailwind entrypoint, palette custom properties, the global 44px
                            touch floor, the focus ring, and prefers-reduced-motion
  types.ts                 The shapes the backend returns (mirrors backend/src/types.ts)
  lib/                       (the reasoning; all pure, all with a matching *.test.ts)
    dashboardLayout.ts       Which panels are on screen and how loudly — decided by the clock
                              and by whether a panel has anything in it. One lead panel plus
                              three alongside; everything else is one tap away
    timeOfDay.ts             Which part of the day it is, and how to stack the day around it
    routinePlan.ts           The morning and bedtime, planned *backwards* from the time they
                              have to be finished. Learns each step's real duration as the
                              median of finished runs; a step nobody ticked has no duration
    focusRhythm.ts           Which length of work block actually gets finished, hours filed
                              vs hours merely worked, and what the record shows about when
                              blocks hold together
    insights.ts              "What we've noticed" — every observation carries its evidence,
                              and its subject is a chore or a meal or a list, never a person
    routines.ts              Meal rhythms, grocery cadences, busiest day, and the week draft
    schoolDay.ts             The school day: which day is the one to prepare for (today until the
                              after-school window closes, tomorrow after), what the sheet says has
                              to be in the bag, and whether anyone has ticked it off. A tick is
                              filed against the day the note is *for* — `prepRecordFor`, which is
                              the rule that decides whether this feature helps or nags. Also
                              merges the specials rotation into the calendar rather than storing
                              it as a year of events
    gemThreats.ts            Which chore has slipped its window, and which character comes for it
    familyKey.ts             The per-device family id + key (see "Connecting a screen" below)
    api.ts                   Typed fetch client: friendly errors, a 12s timeout, one retry on reads
  components/                (every component below has a matching *.test.tsx)
    Dashboard.tsx            Fetches everything, holds the state, and places the panels
    FamilyCard.tsx           The card surface — hero/default/compact, and it does *not* choose
                              its own grid span; placement comes from whoever lays out the screen
    MorningLaunch.tsx        The full-screen routine: one step, the deadline, the slack
    MorningRoutine.tsx       Setting a routine up and checking it (morning or bedtime)
    FocusSession.tsx         A work block and the timesheet line that closes it
    FocusDay.tsx             The day's filed hours, and the way into the next block
    TaskList.tsx             Today's chores, grouped by part of the day and reordered by the clock
    Kitchen.tsx              The meal plan and the shopping list, behind one pair of tabs
    Insights.tsx             What we've noticed, each with its because
    SchoolSetup.tsx          Typing the sheet from the fridge in, laid out as the school lays it
                              out. Edits what changes — the rotation, the teacher — and carries
                              the lunch-menu source through untouched, because a save replaces
                              the whole profile
    SchoolDay.tsx            Tomorrow's specials and what they need brought, ticked off or not,
                              plus that day's published school lunch. An untouched note reads
                              "still not ticked off" — a fact about the records — and never
                              "forgotten", on a screen the child can read
    PrizeGoal.tsx            What each child is saving for, and claiming it
    GemCastle.tsx            The castle, opened from the header's gem total
    Calendar.tsx / MealPlan.tsx / GroceryCart.tsx / FamilyFavorites.tsx / ChoreLibrary.tsx
    LinkDevice.tsx           First-run setup; ErrorBoundary.tsx keeps a crash off the wall
  test/setup.ts             Vitest setup (jest-dom matchers)
  theme.contrast.test.ts     Reads the palette out of tailwind.config.js and asserts a real
                              contrast ratio per pair the components actually render
public/
  icon.svg                 The app mark: the house and the sprig, no wordmark. The one
                            drawing every icon below is rendered from
  brand-mark.png           The full lockup, wordmark included — link previews only
  favicon-32.png, apple-touch-icon-180.png, icon-192.png, icon-512.png,
  icon-maskable-512.png    Generated. See "Brand assets"
scripts/
  render-icons.mjs         Renders icon.svg into those PNGs (`npm run icons`)
  check-icons.mjs          Checks what a launcher will actually show (`npm run verify:icons`)
  check-bundle-has-no-key.mjs  Proves the family key cannot reach the bundle
```

## Brand assets

There are two marks, and the difference matters.

`brand-mark.png` is the full **lockup** — house, sprig and the word
"youenjoymyfamily" underneath. `icon.svg` is the **glyph** alone. The lockup
used to do both jobs, and it was wrong at every size an icon appears: 1.6% of
that square is drawing and the rest is cream, so the wordmark is about six
pixels tall by the time a browser has it in a tab or a phone has it on a home
screen. It is not cropped, just unreadable. The glyph is drawn roughly seven
times heavier for the same square.

So: the lockup is for link previews and anywhere it is shown large. Everything
that is an *icon* comes from `icon.svg`, including the header avatar, which
takes the SVG directly and so stays crisp at whatever the Echo Show's pixel
ratio turns out to be.

After editing `icon.svg`:

```bash
npm run icons         # re-render the PNGs (needs the Playwright Chromium)
npm run verify:icons  # then check them, and commit both
```

`verify:icons` runs in CI. It decodes each committed PNG and asserts three
things that otherwise only fail on somebody's phone: the declared size is the
real size, there is enough ink to read once a launcher shrinks it, and the
maskable icon stays inside the safe circle Android crops to. The PNGs are
committed rather than generated at build time because a headless browser in
CI would cost every run minutes to reproduce a file that already exists.

## Local development

```bash
cp .env.example .env    # VITE_API_BASE_URL, plus the family id + key for local dev only
npm install
npm run dev
```

## Checks

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint src
npm test              # vitest run (jsdom + @testing-library/react)
npm run build         # typecheck + production build
npm run verify:bundle # rebuilds with a canary key and proves it cannot reach the output
npm run verify:icons  # reads the committed icon PNGs; see "Brand assets" below
```

## Deploy (so phones can reach it)

`backend/template.yaml` provisions the hosting: a private S3 bucket behind a
CloudFront distribution. Deploy the backend stack first, then upload this
app's build output into it.

```bash
cd ../backend && sam deploy            # note the FrontendBucketName,
                                        # FrontendDistributionId and ApiUrl outputs
cd ../frontend
VITE_API_BASE_URL=<ApiUrl> npm run build   # no key: each screen is linked on the device

# Hashed assets can cache forever; index.html and the manifest must not, or
# the family keeps loading last week's build.
aws s3 sync dist/ s3://<FrontendBucketName>/ --delete \
  --exclude index.html --exclude manifest.webmanifest \
  --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html s3://<FrontendBucketName>/index.html \
  --cache-control "no-cache"
aws s3 cp dist/manifest.webmanifest s3://<FrontendBucketName>/manifest.webmanifest \
  --cache-control "no-cache"

aws cloudfront create-invalidation --distribution-id <FrontendDistributionId> --paths "/*"
```

Open the stack's `FrontendUrl` output on a phone and use the browser's
**Add to Home Screen** — the web manifest makes it open chrome-less, like an
app. Every screen re-reads the family's data every 30 seconds and whenever it
becomes visible again, so a meal or grocery item edited on a phone shows up on
the kitchen Echo Show without anyone reloading.

## Connecting a screen

The family's API key is **not** in the build. A production bundle has no
way to contain it — the branch that would read it from the environment is
compiled out, and `npm run verify:bundle` builds with a canary key and
fails if it ever appears in the output (CI runs this).

Instead, each screen is linked once. On first load it asks for the family
id and key (both from `POST /families`, see `backend/README.md`), keeps
them in that device's `localStorage`, and sends the key only as the
`Authorization` header it was always meant to be. If the key is ever
rotated or revoked, the screen notices the rejection and returns to the
same setup step rather than looping on an error.

This is deliberately not a login. It's a household of a handful of
devices, and inventing accounts and password resets for four people who
live together would be more to go wrong, not less. What it does buy is
that the URL alone is no longer enough: someone who finds the CloudFront
address gets a setup prompt, not the children's names.

## Known issues

- `vitest`/`vite`'s dev-server-only advisories (moderate/high — path
  traversal in the Vite dev server's optimized-deps handling, and in
  `@vitest/mocker`'s redirect mock) need a coordinated Vite 6+ major bump
  to clear (vitest 4+ requires it); not fixed here to avoid an
  unvalidated breaking change. A prior **critical** vitest advisory
  (arbitrary file read when the Vitest UI server is listening,
  [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp))
  *is* fixed by pinning `vitest` to `^3.2.7` — this project never runs
  `vitest --ui`, but there was no reason to leave a critical CVE
  unpatched when a non-breaking fix existed.
