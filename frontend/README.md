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
cp .env.example .env    # VITE_API_BASE_URL + VITE_FAMILY_API_KEY (see backend/README.md's Authentication section)
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
VITE_API_BASE_URL=<ApiUrl> VITE_FAMILY_API_KEY=<family key> npm run build

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

> **Note on the API key.** `VITE_FAMILY_API_KEY` is baked into the built
> JavaScript, so anyone who can load the site can read it. That's an
> acceptable trade for a single family on an unlisted CloudFront URL, but it
> is *not* multi-tenant-safe — don't hand the URL out, and move to per-user
> auth (e.g. Cognito) before this ever serves more than one household.

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
