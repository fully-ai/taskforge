import path from "node:path";
import { TaskForgeDB } from "./db.js";

const dataDir = path.resolve(process.env.TASKFORGE_DATA_DIR ?? "./data");
const db = new TaskForgeDB(dataDir);
const versions = db.db.prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version").all();
console.log("Applied migrations:", versions);
db.close();
