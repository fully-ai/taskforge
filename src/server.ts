import { createTaskForgeApp } from "./app.js";

const host = process.env.TASKFORGE_HOST ?? "127.0.0.1";
const port = Number(process.env.TASKFORGE_PORT ?? 3100);
const { app } = createTaskForgeApp();

app.listen(port, host, () => {
  console.log(`TaskForge listening on http://${host}:${port}`);
});
