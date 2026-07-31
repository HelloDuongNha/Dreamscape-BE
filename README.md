# DreamScape Backend

The backend is a TypeScript modular monolith built with Express. Business behaviour belongs to `src/modules`, while `src/routes` composes the public API without duplicating business logic.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

MongoDB, Redis, messaging encryption and the external services required by the selected feature must be configured in `.env`. Do not commit that file.

## Verify

```bash
npm run typecheck
npm run verify:route-contract
npm test
npm run build
```

## Optional document worker

The authenticated Docling worker and its requirements are documented in `src/modules/academic/services/ingestion/docling/runtime/WORKER.md`.
