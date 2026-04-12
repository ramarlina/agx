import fs from "fs";
import path from "path";
import { homedir } from "os";

import { parseNoteFile } from "./parser";
import { serializeNoteFile } from "./serializer";
import type {
  ObjectiveNoteFile,
  ObjectiveNoteListOptions,
  ObjectiveNotePage,
} from "./types";

function resolveAgxDataDir(): string {
  const configured = process.env.AGX_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(homedir(), ".agx");
}

export function getNotesDir(projectSlug: string, objectiveKey: string): string {
  return path.join(
    resolveAgxDataDir(),
    "projects",
    projectSlug,
    "objectives",
    objectiveKey,
    "notes",
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function buildNoteFilename(note: ObjectiveNoteFile): string {
  const ts = note.createdAt.replace(/[:.]/g, "-").replace("T", "-").replace("Z", "");
  const slug = slugify(note.title);
  return `${ts}-${slug}.md`;
}

export class NoteRepository {
  readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  private ensureDir(): void {
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  readAll(): ObjectiveNoteFile[] {
    if (!fs.existsSync(this.rootDir)) return [];

    const files = fs.readdirSync(this.rootDir).filter((name) => name.endsWith(".md"));
    const notes: ObjectiveNoteFile[] = [];

    for (const file of files) {
      const filePath = path.join(this.rootDir, file);
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        notes.push(parseNoteFile(raw, { filePath }));
      } catch (error) {
        console.error(`[notes] failed to read ${filePath}:`, error);
      }
    }

    return notes.sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  }

  list(options: ObjectiveNoteListOptions = {}): ObjectiveNotePage {
    const notes = this.readAll();
    const total = notes.length;
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 25));
    const offset = (page - 1) * limit;
    const paged = notes.slice(offset, offset + limit);

    return {
      notes: paged,
      total,
      page,
      limit,
      hasMore: offset + limit < total,
    };
  }

  append(note: ObjectiveNoteFile): string {
    this.ensureDir();
    const filename = buildNoteFilename(note);
    const filePath = path.join(this.rootDir, filename);
    const content = serializeNoteFile(note);
    fs.writeFileSync(filePath, content, "utf8");
    return filePath;
  }

  findById(noteId: string): ObjectiveNoteFile | null {
    const notes = this.readAll();
    return notes.find((n) => n.id === noteId) ?? null;
  }

  update(noteId: string, patch: Partial<Pick<ObjectiveNoteFile, "title" | "body">>): ObjectiveNoteFile | null {
    if (!fs.existsSync(this.rootDir)) return null;

    const files = fs.readdirSync(this.rootDir).filter((name) => name.endsWith(".md"));

    for (const file of files) {
      const filePath = path.join(this.rootDir, file);
      let raw: string;
      try {
        raw = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }

      let note: ObjectiveNoteFile;
      try {
        note = parseNoteFile(raw, { filePath });
      } catch {
        continue;
      }

      if (note.id !== noteId) continue;

      const updated: ObjectiveNoteFile = {
        ...note,
        title: patch.title ?? note.title,
        body: patch.body ?? note.body,
        updatedAt: new Date().toISOString(),
      };

      const newFilename = buildNoteFilename(updated);
      const newFilePath = path.join(this.rootDir, newFilename);

      fs.writeFileSync(newFilePath, serializeNoteFile(updated), "utf8");

      if (newFilePath !== filePath) {
        fs.unlinkSync(filePath);
      }

      return updated;
    }

    return null;
  }

  delete(noteId: string): boolean {
    if (!fs.existsSync(this.rootDir)) return false;

    const files = fs.readdirSync(this.rootDir).filter((name) => name.endsWith(".md"));

    for (const file of files) {
      const filePath = path.join(this.rootDir, file);
      let raw: string;
      try {
        raw = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }

      let note: ObjectiveNoteFile;
      try {
        note = parseNoteFile(raw, { filePath });
      } catch {
        continue;
      }

      if (note.id !== noteId) continue;

      fs.unlinkSync(filePath);
      return true;
    }

    return false;
  }
}

const repositoryCache = new Map<string, NoteRepository>();

export function getNoteRepository(
  projectSlug: string,
  objectiveKey: string,
): NoteRepository {
  const rootDir = getNotesDir(projectSlug, objectiveKey);
  let repo = repositoryCache.get(rootDir);
  if (!repo) {
    repo = new NoteRepository(rootDir);
    repositoryCache.set(rootDir, repo);
  }
  return repo;
}
