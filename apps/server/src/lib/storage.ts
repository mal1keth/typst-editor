import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync, statSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || join(__dirname, "../../data");
const projectsDir = join(dataDir, "projects");
mkdirSync(projectsDir, { recursive: true });

export function getProjectDir(projectId: string): string {
  return join(projectsDir, projectId);
}

export function getFilePath(projectId: string, filePath: string): string {
  // Prevent path traversal
  const normalized = filePath.replace(/\.\./g, "").replace(/^\/+/, "");
  return join(projectsDir, projectId, normalized);
}

export function ensureProjectDir(projectId: string): void {
  mkdirSync(getProjectDir(projectId), { recursive: true });
}

export function writeProjectFile(
  projectId: string,
  filePath: string,
  content: string | Buffer
): void {
  const fullPath = getFilePath(projectId, filePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

export function readProjectFile(
  projectId: string,
  filePath: string
): string | null {
  const fullPath = getFilePath(projectId, filePath);
  if (!existsSync(fullPath)) return null;
  return readFileSync(fullPath, "utf-8");
}

export function readProjectFileBinary(
  projectId: string,
  filePath: string
): Buffer | null {
  const fullPath = getFilePath(projectId, filePath);
  if (!existsSync(fullPath)) return null;
  return readFileSync(fullPath);
}

export function deleteProjectFile(
  projectId: string,
  filePath: string
): boolean {
  const fullPath = getFilePath(projectId, filePath);
  if (!existsSync(fullPath)) return false;
  const stat = statSync(fullPath);
  if (stat.isDirectory()) {
    rmSync(fullPath, { recursive: true });
  } else {
    unlinkSync(fullPath);
  }
  return true;
}

export function deleteProjectDir(projectId: string): void {
  const dir = getProjectDir(projectId);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true });
  }
}

export interface FileEntry {
  path: string;
  isDirectory: boolean;
  sizeBytes: number;
}

export function listProjectFiles(projectId: string): FileEntry[] {
  const dir = getProjectDir(projectId);
  if (!existsSync(dir)) return [];

  const entries: FileEntry[] = [];

  function walk(currentDir: string, prefix: string) {
    const items = readdirSync(currentDir);
    for (const item of items) {
      const fullPath = join(currentDir, item);
      const relativePath = prefix ? `${prefix}/${item}` : item;
      const stat = statSync(fullPath);
      entries.push({
        path: relativePath,
        isDirectory: stat.isDirectory(),
        sizeBytes: stat.isDirectory() ? 0 : stat.size,
      });
      if (stat.isDirectory()) {
        walk(fullPath, relativePath);
      }
    }
  }

  walk(dir, "");
  return entries;
}
