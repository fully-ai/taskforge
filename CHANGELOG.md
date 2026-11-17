# Changelog

## [0.3.0] - 2026-11-18

### Added
- **Migration `003_comments_subtasks.sql`**: Persistent `task_comments` and `task_subtasks` tables with indexes.
- **Task Detail Modal, Comments & Checklists**: `GET /api/tasks/:taskId`, comments CRUD with ownership/admin enforcement, and subtask creation/toggle/deletion logged to activity history.
- **Overdue Filter & Formula-Safe CSV/JSON Export**: `?overdue=true` filtering, overdue board badges, and `GET /api/projects/:id/export?format=csv|json`.
- **Security & Tooling**: Escaped UI rendering (`esc()`), plus `scripts/{install,dev,test}.{sh,ps1}`.

## [0.2.0] - 2026-11-16

### Added
- Interactive Kanban UI controls for moving tasks across columns, searching tasks, viewing activity logs, and reading notifications.
- Integration tests for column filtering and due-date/title updates.
- Comprehensive README with Mermaid diagram, API documentation, and migration reference.

## [0.1.0] - 2026-11-16

### Added
- Versioned SQLite migrations (`migrations/001_init.sql`, `migrations/002_notifications.sql`).
- Multi-project Kanban boards with labels, priorities, due dates, assignees, and filtered search.
- Activity audit history, user assignment notifications, JWT auth, and Kanban web UI.
