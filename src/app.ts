import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { hashPassword, requireAuth, signToken, verifyPassword, type AuthedRequest } from "./auth.js";
import { TaskForgeDB } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const VALID_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

export function createTaskForgeApp(opts: { dataDir?: string; jwtSecret?: string } = {}) {
  const dataDir = path.resolve(opts.dataDir ?? process.env.TASKFORGE_DATA_DIR ?? "./data");
  const jwtSecret = opts.jwtSecret ?? process.env.TASKFORGE_JWT_SECRET ?? crypto.randomBytes(32).toString("hex");
  const db = new TaskForgeDB(dataDir);
  const auth = requireAuth(db, jwtSecret);
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/auth/register", (req, res) => {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username) || password.length < 8) {
      res.status(400).json({ error: "Invalid username or password (min 8 chars)" });
      return;
    }
    if (db.getUserByUsername(username)) {
      res.status(409).json({ error: "Username already exists" });
      return;
    }
    const user = db.createUser(username, hashPassword(password));
    res.status(201).json({ token: signToken(user, jwtSecret), user });
  });

  app.post("/api/auth/login", (req, res) => {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");
    const u = db.getUserByUsername(username);
    if (!u || !verifyPassword(password, String(u.password_hash))) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const user = { id: String(u.id), username: String(u.username), role: String(u.role) };
    res.json({ token: signToken(user, jwtSecret), user });
  });

  app.get("/api/projects", auth, (_req, res) => {
    res.json({ projects: db.listProjects() });
  });

  app.post("/api/projects", auth, (req: AuthedRequest, res) => {
    const key = String(req.body?.key ?? "").trim();
    const name = String(req.body?.name ?? "").trim();
    const description = String(req.body?.description ?? "").trim();
    if (!/^[a-zA-Z0-9]{2,10}$/.test(key) || !name) {
      res.status(400).json({ error: "Project key (2-10 alphanumeric) and name are required" });
      return;
    }
    try {
      const project = db.createProject(key, name, description, req.user!.id);
      res.status(201).json(project);
    } catch {
      res.status(409).json({ error: "Project key already exists" });
    }
  });

  app.get("/api/projects/:id/board", auth, (req, res) => {
    const pid = String(req.params.id);
    const project = db.getProject(pid);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json({
      project,
      columns: db.listColumns(pid),
      labels: db.listLabels(pid),
      tasks: db.searchTasks(pid, {}),
    });
  });

  app.post("/api/projects/:id/labels", auth, (req, res) => {
    const pid = String(req.params.id);
    if (!db.getProject(pid)) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const name = String(req.body?.name ?? "").trim();
    const color = String(req.body?.color ?? "#3b82f6").trim();
    if (!name) {
      res.status(400).json({ error: "Label name is required" });
      return;
    }
    try {
      res.status(201).json(db.createLabel(pid, name, color));
    } catch {
      res.status(409).json({ error: "Label already exists" });
    }
  });

  app.get("/api/projects/:id/tasks", auth, (req, res) => {
    const pid = String(req.params.id);
    if (!db.getProject(pid)) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const tasks = db.searchTasks(pid, {
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      priority: typeof req.query.priority === "string" ? req.query.priority : undefined,
      column: typeof req.query.column === "string" ? req.query.column : undefined,
      label: typeof req.query.label === "string" ? req.query.label : undefined,
    });
    res.json({ tasks });
  });

  app.post("/api/projects/:id/tasks", auth, (req: AuthedRequest, res) => {
    const pid = String(req.params.id);
    if (!db.getProject(pid)) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const title = String(req.body?.title ?? "").trim();
    const description = String(req.body?.description ?? "").trim();
    const columnName = String(req.body?.column_name ?? "backlog");
    const priority = String(req.body?.priority ?? "medium");
    if (!title || !VALID_PRIORITIES.has(priority)) {
      res.status(400).json({ error: "Valid title and priority (low|medium|high|urgent) required" });
      return;
    }
    const task = db.createTask({
      projectId: pid,
      title,
      description,
      columnName,
      priority,
      dueDate: req.body?.due_date ? String(req.body.due_date) : null,
      assigneeId: req.body?.assignee_id ? String(req.body.assignee_id) : null,
      createdBy: req.user!.id,
      labelIds: Array.isArray(req.body?.label_ids) ? req.body.label_ids.map(String) : [],
    });
    res.status(201).json(task);
  });

  app.patch("/api/tasks/:taskId", auth, (req: AuthedRequest, res) => {
    const priority = req.body?.priority !== undefined ? String(req.body.priority) : undefined;
    if (priority && !VALID_PRIORITIES.has(priority)) {
      res.status(400).json({ error: "Invalid priority" });
      return;
    }
    const updated = db.updateTask(String(req.params.taskId), req.user!.id, {
      title: req.body?.title !== undefined ? String(req.body.title) : undefined,
      description: req.body?.description !== undefined ? String(req.body.description) : undefined,
      columnName: req.body?.column_name !== undefined ? String(req.body.column_name) : undefined,
      priority,
      dueDate: req.body?.due_date !== undefined ? (req.body.due_date ? String(req.body.due_date) : null) : undefined,
      assigneeId:
        req.body?.assignee_id !== undefined ? (req.body.assignee_id ? String(req.body.assignee_id) : null) : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(updated);
  });

  app.get("/api/projects/:id/activity", auth, (req, res) => {
    res.json({ activity: db.listActivity(String(req.params.id)) });
  });

  app.get("/api/notifications", auth, (req: AuthedRequest, res) => {
    res.json({ notifications: db.listNotifications(req.user!.id) });
  });

  app.post("/api/notifications/:id/read", auth, (req: AuthedRequest, res) => {
    if (!db.markNotificationRead(String(req.params.id), req.user!.id)) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json({ status: "read" });
  });

  app.use(express.static(PUBLIC_DIR));
  return { app, db };
}
