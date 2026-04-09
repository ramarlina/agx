import { getSQLiteDb } from "@/lib/sqlite-query-adapter";
import { migrateLegacyWorkspacesToProjects } from "@/lib/workspaces-to-projects-migration";

const db = getSQLiteDb();
const result = migrateLegacyWorkspacesToProjects(db);

console.log(JSON.stringify(result, null, 2));
