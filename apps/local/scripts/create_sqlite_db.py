#!/usr/bin/env python3
"""
Create a fresh SQLite database from the migration DDL.

Usage:
    python scripts/create_sqlite_db.py [--db-path <path>] [--ddl <path>]

Defaults:
    --db-path  data/agx.db
    --ddl      migrations/sqlite_schema.sql
"""

import argparse
import sqlite3
import sys
from pathlib import Path

EXPECTED_TABLES = [
    "device_codes",
    "learnings",
    "user_secrets",
    "workflows",
    "projects",
    "project_repos",
    "rate_limits",
    "stage_prompts",
    "task_templates",
    "user_settings",
    "tasks",
    "task_audit_log",
    "task_comments",
    "task_logs",
    "task_costs",
    "task_run_history",
    "task_workflow_events",
    "workflow_instances",
    "workflow_nodes",
    "workflow_transitions",
    "agents",
    "teams",
    "team_agents",
    "project_agents",
    "project_skills",
    "project_variables",
    "project_memory",
    "project_threads",
    "execution_graphs",
    "graph_nodes",
    "graph_edges",
    "graph_events",
    "graph_migration_backups",
]

# Expected FK relationships: child_table -> [(parent_table, from_col, to_col), ...]
EXPECTED_FKS = {
    "projects": [("workflows", "workflow_id", "id")],
    "project_repos": [("projects", "project_id", "id")],
    "stage_prompts": [("workflows", "workflow_id", "id")],
    "tasks": [("projects", "project_id", "id")],
    "task_audit_log": [("tasks", "task_id", "id")],
    "task_comments": [("tasks", "task_id", "id")],
    "task_logs": [("tasks", "task_id", "id")],
    "task_costs": [("tasks", "task_id", "id")],
    "task_run_history": [("tasks", "task_id", "id")],
    "task_workflow_events": [("tasks", "task_id", "id")],
    "workflow_instances": [
        ("workflows", "workflow_id", "id"),
        ("projects", "project_id", "id"),
    ],
    "workflow_nodes": [("workflows", "workflow_id", "id")],
    "workflow_transitions": [
        ("workflows", "workflow_id", "id"),
        ("workflow_nodes", "from_node_id", "id"),
        ("workflow_nodes", "to_node_id", "id"),
    ],
    "teams": [("projects", "project_id", "id")],
    "team_agents": [
        ("teams", "team_id", "id"),
        ("agents", "agent_id", "id"),
    ],
    "project_agents": [
        ("projects", "project_id", "id"),
        ("agents", "agent_id", "id"),
    ],
    "project_skills": [("projects", "project_id", "id")],
    "project_variables": [("projects", "project_id", "id")],
    "project_memory": [("projects", "project_id", "id")],
    "project_threads": [("projects", "project_id", "id")],
    "execution_graphs": [("tasks", "task_id", "id")],
    "graph_nodes": [("execution_graphs", "graph_id", "id")],
    "graph_edges": [("execution_graphs", "graph_id", "id")],
    "graph_events": [("execution_graphs", "graph_id", "id")],
}


def main():
    parser = argparse.ArgumentParser(description="Create SQLite DB from DDL")
    parser.add_argument(
        "--db-path",
        default="data/agx.db",
        help="Path to SQLite database file (default: data/agx.db)",
    )
    parser.add_argument(
        "--ddl",
        default="migrations/sqlite_schema.sql",
        help="Path to DDL file (default: migrations/sqlite_schema.sql)",
    )
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    db_path = project_root / args.db_path
    ddl_path = project_root / args.ddl

    if not ddl_path.exists():
        print(f"ERROR: DDL file not found: {ddl_path}", file=sys.stderr)
        sys.exit(1)

    if db_path.exists():
        print(f"WARNING: {db_path} already exists. Will apply DDL with IF NOT EXISTS.")

    # Ensure parent directory exists
    db_path.parent.mkdir(parents=True, exist_ok=True)

    ddl = ddl_path.read_text()

    print(f"Creating SQLite DB: {db_path}")
    print(f"DDL source: {ddl_path}")

    conn = sqlite3.connect(str(db_path))
    try:
        conn.executescript(ddl)
        print("  DDL executed successfully")

        # Validate tables
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        actual_tables = [row[0] for row in cursor.fetchall()]

        print(f"\n  Tables created: {len(actual_tables)}")
        missing = set(EXPECTED_TABLES) - set(actual_tables)
        extra = set(actual_tables) - set(EXPECTED_TABLES)
        if missing:
            print(f"  MISSING tables: {sorted(missing)}")
        if extra:
            print(f"  Extra tables: {sorted(extra)}")

        ok = True

        # Validate foreign keys are enabled
        fk_status = conn.execute("PRAGMA foreign_keys").fetchone()[0]
        if fk_status == 1:
            print("  PRAGMA foreign_keys = ON")
        else:
            print("  WARNING: foreign_keys is OFF")
            ok = False

        # Validate FK definitions per table
        print("\n  Foreign key definitions:")
        for table in EXPECTED_TABLES:
            fks = conn.execute(f"PRAGMA foreign_key_list({table})").fetchall()
            if fks:
                for fk in fks:
                    # fk: (id, seq, parent_table, from_col, to_col, on_update, on_delete, match)
                    print(f"    {table}.{fk[3]} -> {fk[2]}.{fk[4]}")

        # FK integrity check on empty DB (should pass trivially)
        fk_errors = conn.execute("PRAGMA foreign_key_check").fetchall()
        if not fk_errors:
            print("\n  PRAGMA foreign_key_check: PASS")
        else:
            print(f"\n  PRAGMA foreign_key_check: FAIL ({len(fk_errors)} violations)")
            ok = False

        # Integrity check
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity == "ok":
            print("  PRAGMA integrity_check: ok")
        else:
            print(f"  PRAGMA integrity_check: {integrity}")
            ok = False

        if missing:
            ok = False

        if ok:
            print("\nSQLite database created and validated successfully.")
        else:
            print("\nDatabase created but validation had warnings.", file=sys.stderr)
            sys.exit(1)

    finally:
        conn.close()


if __name__ == "__main__":
    main()
