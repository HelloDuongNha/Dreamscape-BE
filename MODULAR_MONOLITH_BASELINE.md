# DreamScape Modular Monolith Baseline

This file defines the refactoring safety boundary captured before moving runtime code.

## Baseline

- Branch at capture time: `refactor`
- Feature routes: 98
- Health routes: 1
- Runtime controllers: 12
- Contract test files: 26
- Human messaging remains isolated from Oracle.
- Existing HTTP method, path, middleware order, handler binding, status code, response shape, and database side effects must remain compatible during a move-only phase.

Run the complete baseline gate with:

```bash
npm run verify:refactor-baseline
```

## Module ownership

| Module | Owns | Must not own |
| --- | --- | --- |
| `academic` | Sources, contributions, Smart Reader, PDF/Docling ingestion, reader translation, academic assets | Rule moderation decisions, Oracle runs |
| `rules_v3` | Rule extraction, evidence anchors, scoring, merge, validation, rule moderation | PDF ingestion and source catalog |
| `dream` | Dream CRUD, privacy, additions, analysis jobs, dream feedback | Human messaging |
| `oracle` | Oracle threads, turns, runs, credentials, citations, Evidence Needed | `Conversation`, `Message`, Socket.IO human chat |
| `identity` | Authentication, OTP, sessions, user profile | Human chat and Oracle |
| `messaging` | Human conversations, messages, Socket.IO message lifecycle | Oracle turns/runs |
| `social` | Comments, notifications, achievements and contribution-facing statistics | Authentication credentials |

## Dependency rules

1. Routes remain the composition root and preserve their public paths.
2. Cross-module imports must use a module public API instead of importing another module's internal file.
3. `infrastructure` may be used by every module but must not import a business module.
4. `oracle` may consume public APIs from `dream`, `rules_v3`, and `academic`.
5. `dream` may consume public APIs from `rules_v3` and `identity`.
6. `rules_v3` may consume the canonical-reader API from `academic`.
7. Academic reader replacement may notify Rules through a public lifecycle port; it must not import Rules persistence internals.
8. `messaging` remains independent from Oracle.

## Migration rules

- Do not delete tests. Move them with the implementation or move shared fixtures to shared testing support.
- Do not comment out dead implementations. Git retains history; only compatibility facades receive `@deprecated` documentation.
- Root model/controller/service compatibility files may temporarily re-export module APIs.
- A move-only phase cannot alter schemas, indexes, endpoint contracts, feature flags, provider selection, timers, cancellation, transaction boundaries, or restoration behavior.
- After each module phase: run the baseline gate, start the server, and complete that module's UI checklist before proceeding.

