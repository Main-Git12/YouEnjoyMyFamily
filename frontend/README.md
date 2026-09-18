# PealSync frontend

React + Vite dashboard SPA, styled with Tailwind using an olive/earthy
palette (`tailwind.config.js`, `src/theme.css`) tuned for readability on
Echo Show displays: large touch targets, high contrast, muted colors.

## Structure

```
src/
  App.jsx                 Root component
  main.jsx                Vite entry point
  theme.css               Tailwind entrypoint + CSS custom properties for the palette
  lib/api.js               Thin fetch client for the PealSync backend
  components/
    Dashboard.jsx           Fetches tasks/schedule and lays out the two-panel view
    FamilyCard.jsx           Reusable card surface (olive or clay accent)
    TaskList.jsx             Task list panel
    Calendar.jsx             Schedule list panel
```

## Local development

```bash
cp .env.example .env    # point VITE_API_BASE_URL at your backend (SAM local or deployed)
npm install
npm run dev
```
