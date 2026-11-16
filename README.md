# TaskForge

Self-hosted Kanban project and task management platform built with TypeScript, Express, and SQLite (`node:sqlite`) with versioned SQL migrations.

## Features

- **Projects & Kanban Boards**: Create projects with default `backlog`, `in_progress`, `review`, and `done` columns.
- **Task Workflows**: Priorities (`low`, `medium`, `high`, `urgent`), due dates, assignees, labels, and filtered search (`q`, `priority`, `column`, `label`).
- **Activity & Notifications**: Tracks project/task mutations in `activity_logs` and generates notifications on task assignment.
- **Versioned Migrations**: Incremental SQL migration runner tracked via `schema_migrations`.
- **Docker Compose Ready**: Persistent `/data` volume and production-ready `compose.yaml`.

## Installation & Running

```bash
git clone https://github.com/fully-ai/taskforge.git
cd taskforge
npm ci
npm run migrate
TASKFORGE_JWT_SECRET="replace-with-a-random-secret" npm start
```

## Testing

```bash
npm run lint
npm test
```

## License

Apache License 2.0 — see [LICENSE](LICENSE).
