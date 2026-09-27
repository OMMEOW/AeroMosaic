# AeroMosaic web app

Next.js (App Router) + TypeScript + Tailwind v4. It talks only to the FastAPI backend
(`NEXT_PUBLIC_API_BASE_URL`, default `http://localhost:8000`, overridable in Settings).
Every wire shape is in `src/services/contract.ts`; run state is the fold of the run's events
(`src/lib/runReducer.ts`).

```sh
npm install
npm run dev        # http://localhost:3000
npx tsc --noEmit && npx eslint src
```

End-to-end test: `e2e/run_e2e.cjs` (Playwright; drives a real run against the live backend).
See the project README one level up.
