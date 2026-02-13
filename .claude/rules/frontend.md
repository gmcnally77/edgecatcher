---
globs: frontend/**/*.{ts,tsx}
---

# Frontend Rules

## Imports
- Use `@/` path aliases (configured in tsconfig.json), never relative paths.

## Styling
- Tailwind CSS only. No inline styles or CSS modules.

## Framework
- Next.js App Router. Pages in `frontend/app/`, components in `frontend/components/`.
- Supabase JS client for data fetching (`@supabase/supabase-js`).
