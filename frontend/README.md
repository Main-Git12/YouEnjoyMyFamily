# YouEnjoyMyFamily frontend

React + Vite + TypeScript dashboard SPA, styled with Tailwind using an
olive/earthy palette (`tailwind.config.js`, `src/theme.css`) tuned for
readability on Echo Show displays: large touch targets, high contrast,
muted colors.

## Structure

```
src/
  App.tsx                  Root component
  main.tsx                 Vite entry point
  theme.css                Tailwind entrypoint + CSS custom properties for the palette
  types.ts                 Task/ScheduleEntry/CartItem shapes returned by the backend
  lib/
    api.ts                   Thin, typed fetch client for the YouEnjoyMyFamily backend
    api.test.ts              Vitest tests (mocked global fetch)
  components/                (every component below has a matching *.test.tsx)
    Dashboard.tsx            Fetches tasks/schedule and lays out the two-panel view;
                              tests mock ../lib/api to cover the success and error states
    FamilyCard.tsx           Reusable card surface (olive or clay accent)
    TaskList.tsx             Task list panel
    Calendar.tsx             Schedule list panel
  test/setup.ts             Vitest setup (jest-dom matchers)
```

## Local development

```bash
cp .env.example .env    # VITE_API_BASE_URL, plus the family id + key for local dev only
npm install
npm run dev
```

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm run lint         # eslint src
npm test              # vitest run (jsdom + @testing-library/react)
npm run build         # typecheck + production build
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
