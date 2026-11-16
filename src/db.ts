import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

export function runMigrations(db: DatabaseSync, migrationsDir = DEFAULT_MIGRATIONS_DIR): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: string }>;
  const applied = new Set(appliedRows.map((r) => r.version));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.exec("BEGIN;");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        file,
        new Date().toISOString()
      );
      db.exec("COMMIT;");
      newlyApplied.push(file);
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }
  }
  return newlyApplied;
}

export class TaskForgeDB {
  public readonly db: DatabaseSync;

  constructor(dataDir: string, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "taskforge.db"));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    runMigrations(this.db, migrationsDir);
  }

  close(): void {
    this.db.close();
  }

  createUser(username: string, passwordHash: string): { id: string; username: string; role: string } {
    const cnt = (this.db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
    const role = cnt === 0 ? "admin" : "member";
    const id = crypto.randomUUID();
    this.db
      .prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, username, passwordHash, role, new Date().toISOString());
    return { id, username, role };
  }

  getUserByUsername(username: string): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
      | Record<string, unknown>
      | undefined;
  }

  getUserById(id: string): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  }

  createProject(key: string, name: string, description: string, ownerId: string) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT INTO projects (id, key, name, description, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, key.toUpperCase(), name, description, ownerId, now);

    const defaults = ["backlog", "in_progress", "review", "done"];
    defaults.forEach((col, idx) => {
      this.db
        .prepare("INSERT INTO columns (id, project_id, name, position) VALUES (?, ?, ?, ?)")
        .run(crypto.randomUUID(), id, col, idx);
    });
    this.logActivity(id, null, ownerId, "create_project", `Created project ${key.toUpperCase()}`);
    return this.getProject(id)!;
  }

  listProjects() {
    return this.db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();
  }

  getProject(id: string) {
    return this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  }

  listColumns(projectId: string) {
    return this.db.prepare("SELECT * FROM columns WHERE project_id = ? ORDER BY position ASC").all(projectId);
  }

  createLabel(projectId: string, name: string, color = "#3b82f6") {
    const id = crypto.randomUUID();
    this.db
      .prepare("INSERT INTO labels (id, project_id, name, color) VALUES (?, ?, ?, ?)")
      .run(id, projectId, name, color);
    return this.db.prepare("SELECT * FROM labels WHERE id = ?").get(id);
  }

  listLabels(projectId: string) {
    return this.db.prepare("SELECT * FROM labels WHERE project_id = ? ORDER BY name ASC").all(projectId);
  }

  createTask(input: {
    projectId: string;
    title: string;
    description: string;
    columnName: string;
    priority: string;
    dueDate: string | null;
    assigneeId: string | null;
    createdBy: string;
    labelIds?: string[];
  }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO tasks (id, project_id, title, description, column_name, priority, due_date, assignee_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId,
        input.title,
        input.description,
        input.columnName,
        input.priority,
        input.dueDate,
        input.assigneeId,
        input.createdBy,
        now,
        now
      );

    for (const lid of input.labelIds ?? []) {
      this.db.prepare("INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)").run(id, lid);
    }
    this.logActivity(input.projectId, id, input.createdBy, "create_task", `Created task "${input.title}"`);
    if (input.assigneeId) {
      this.notify(input.assigneeId, id, `You were assigned to task "${input.title}"`);
    }
    return this.getTask(id)!;
  }

  getTask(id: string) {
    const task = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!task) return undefined;
    const labels = this.db
      .prepare(
        `SELECT l.id, l.name, l.color FROM labels l
         JOIN task_labels tl ON tl.label_id = l.id
         WHERE tl.task_id = ?`
      )
      .all(id);
    return { ...task, labels };
  }

  searchTasks(projectId: string, opts: { q?: string; priority?: string; column?: string; label?: string }) {
    let sql = `SELECT DISTINCT t.* FROM tasks t`;
    const params: string[] = [];
    if (opts.label) {
      sql += ` JOIN task_labels tl ON tl.task_id = t.id JOIN labels l ON l.id = tl.label_id`;
    }
    sql += ` WHERE t.project_id = ?`;
    params.push(projectId);

    if (opts.q) {
      sql += ` AND (LOWER(t.title) LIKE ? OR LOWER(t.description) LIKE ?)`;
      const pat = `%${opts.q.toLowerCase()}%`;
      params.push(pat, pat);
    }
    if (opts.priority) {
      sql += ` AND t.priority = ?`;
      params.push(opts.priority);
    }
    if (opts.column) {
      sql += ` AND t.column_name = ?`;
      params.push(opts.column);
    }
    if (opts.label) {
      sql += ` AND l.name = ?`;
      params.push(opts.label);
    }
    sql += ` ORDER BY t.updated_at DESC`;
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => this.getTask(String(r.id))!);
  }

  updateTask(
    taskId: string,
    actorId: string,
    updates: {
      title?: string;
      description?: string;
      columnName?: string;
      priority?: string;
      dueDate?: string | null;
      assigneeId?: string | null;
    }
  ) {
    const existing = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) return undefined;

    const title = updates.title ?? String(existing.title);
    const description = updates.description ?? String(existing.description);
    const columnName = updates.columnName ?? String(existing.column_name);
    const priority = updates.priority ?? String(existing.priority);
    const dueDate = updates.dueDate !== undefined ? updates.dueDate : (existing.due_date as string | null);
    const assigneeId = updates.assigneeId !== undefined ? updates.assigneeId : (existing.assignee_id as string | null);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE tasks SET title = ?, description = ?, column_name = ?, priority = ?, due_date = ?, assignee_id = ?, updated_at = ? WHERE id = ?`
      )
      .run(title, description, columnName, priority, dueDate, assigneeId, now, taskId);

    if (columnName !== existing.column_name) {
      this.logActivity(
        String(existing.project_id),
        taskId,
        actorId,
        "move_task",
        `Moved "${title}" from ${existing.column_name} to ${columnName}`
      );
    }
    if (assigneeId && assigneeId !== existing.assignee_id) {
      this.notify(assigneeId, taskId, `You were assigned to task "${title}"`);
    }
    return this.getTask(taskId);
  }

  logActivity(projectId: string, taskId: string | null, actorId: string, action: string, details: string): void {
    this.db
      .prepare(
        "INSERT INTO activity_logs (id, project_id, task_id, actor_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(crypto.randomUUID(), projectId, taskId, actorId, action, details, new Date().toISOString());
  }

  listActivity(projectId: string) {
    return this.db
      .prepare("SELECT * FROM activity_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 100")
      .all(projectId);
  }

  notify(userId: string, taskId: string | null, message: string): void {
    this.db
      .prepare("INSERT INTO notifications (id, user_id, task_id, message, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)")
      .run(crypto.randomUUID(), userId, taskId, message, new Date().toISOString());
  }

  listNotifications(userId: string) {
    return this.db
      .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50")
      .all(userId);
  }

  markNotificationRead(id: string, userId: string): boolean {
    const res = this.db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?").run(id, userId);
    return res.changes > 0;
  }
}
