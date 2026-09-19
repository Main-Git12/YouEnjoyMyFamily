# PealSync frontend

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
  lib/api.ts                Thin, typed fetch client for the PealSync backend
  components/
    Dashboard.tsx            Fetches tasks/schedule and lays out the two-panel view
    FamilyCard.tsx           Reusable card surface (olive or clay accent)
    TaskList.tsx             Task list panel
    Calendar.tsx             Schedule list panel
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
npm run build         # typecheck + production build
```
