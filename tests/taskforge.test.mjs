import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createTaskForgeApp } from "../dist/app.js";

let tmpDir;
let server;
let db;
let baseUrl;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "taskforge-test-"));
  const created = createTaskForgeApp({
    dataDir: tmpDir,
    jwtSecret: "test-secret-taskforge-integration",
  });
  db = created.db;
  server = await new Promise((resolve) => {
    const s = created.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("migrations, project board, labels, Kanban transitions, search, activity, and notifications", async () => {
  // Register 2 users
  const u1 = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "lead", password: "password123" }),
  }).then((r) => r.json());
  const u2 = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "dev", password: "password123" }),
  }).then((r) => r.json());

  const h1 = { Authorization: `Bearer ${u1.token}`, "Content-Type": "application/json" };
  const h2 = { Authorization: `Bearer ${u2.token}`, "Content-Type": "application/json" };

  // Create project
  const proj = await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: h1,
    body: JSON.stringify({ key: "CORE", name: "Core Platform", description: "Backend services" }),
  }).then((r) => r.json());
  assert.equal(proj.key, "CORE");

  // Create label
  const lbl = await fetch(`${baseUrl}/api/projects/${proj.id}/labels`, {
    method: "POST",
    headers: h1,
    body: JSON.stringify({ name: "security", color: "#ef4444" }),
  }).then((r) => r.json());

  // Create task assigned to dev
  const task = await fetch(`${baseUrl}/api/projects/${proj.id}/tasks`, {
    method: "POST",
    headers: h1,
    body: JSON.stringify({
      title: "Implement rate limiter",
      description: "Protect login endpoint",
      priority: "urgent",
      due_date: "2026-12-01",
      assignee_id: u2.user.id,
      label_ids: [lbl.id],
    }),
  }).then((r) => r.json());
  assert.equal(task.column_name, "backlog");
  assert.equal(task.labels[0].name, "security");

  // Move task across Kanban columns
  const moved = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
    method: "PATCH",
    headers: h2,
    body: JSON.stringify({ column_name: "in_progress" }),
  }).then((r) => r.json());
  assert.equal(moved.column_name, "in_progress");

  // Search by query & label
  const found = await fetch(`${baseUrl}/api/projects/${proj.id}/tasks?q=rate&label=security&priority=urgent`, {
    headers: h1,
  }).then((r) => r.json());
  assert.equal(found.tasks.length, 1);

  // Activity log recorded create + move
  const act = await fetch(`${baseUrl}/api/projects/${proj.id}/activity`, { headers: h1 }).then((r) => r.json());
  assert.ok(act.activity.some((a) => a.action === "move_task"));

  // Dev received assignment notification and marks it read
  const notifs = await fetch(`${baseUrl}/api/notifications`, { headers: h2 }).then((r) => r.json());
  assert.equal(notifs.notifications.length, 1);
  const markRes = await fetch(`${baseUrl}/api/notifications/${notifs.notifications[0].id}/read`, {
    method: "POST",
    headers: h2,
  });
  assert.equal(markRes.status, 200);

  // Filter by column and update due date / title
  const inProg = await fetch(`${baseUrl}/api/projects/${proj.id}/tasks?column=in_progress`, { headers: h1 }).then((r) =>
    r.json()
  );
  assert.equal(inProg.tasks.length, 1);
  const edited = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
    method: "PATCH",
    headers: h1,
    body: JSON.stringify({ title: "Implement login rate limiter", due_date: "2026-12-15" }),
  }).then((r) => r.json());
  assert.equal(edited.title, "Implement login rate limiter");
  assert.equal(edited.due_date, "2026-12-15");
});
