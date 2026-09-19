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
cp .env.example .env    # point VITE_API_BASE_URL at your backend (SAM local or deployed)
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
