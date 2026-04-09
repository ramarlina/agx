import type { NextRequest } from "next/server";
import { createAdminDbClient } from "./db-adapter";

export async function createDbServerClient(): Promise<any> {
  return createAdminDbClient();
}

export async function createDbServerClientWithRequest(_request: NextRequest): Promise<any> {
  return createAdminDbClient();
}
