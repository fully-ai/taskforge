# Architecture — TaskForge

## Components

- `migrations/`: Versioned SQL schema files (`001_init.sql`, `002_notifications.sql`) applied transactionally via `runMigrations` and tracked in `schema_migrations`.
- `src/db.ts` (`TaskForgeDB`): Synchronous SQLite repository (`node:sqlite`) managing users, projects, Kanban columns, tasks, labels, `activity_logs`, and `notifications`.
- `src/auth.ts`: Scrypt password hashing and JWT bearer authentication middleware.
- `src/app.ts` & `public/index.html`: Express REST API and Kanban board interface.
