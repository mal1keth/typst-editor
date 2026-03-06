import { createPatch } from "diff";
import { nanoid } from "nanoid";
import { db, schema } from "../db/index.js";
import { eq, and, desc } from "drizzle-orm";

const GROUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export interface FileChange {
  path: string;
  diffType: "create" | "modify" | "delete";
  oldContent: string | null;
  newContent: string | null;
}

/**
 * Record an edit history entry with unified diffs for changed files.
 * Groups rapid edits (within 5 minutes) by the same user into a single group.
 */
export async function recordEdit(opts: {
  projectId: string;
  userId: string | null;
  source: "edit" | "github_pull" | "file_create" | "file_delete";
  files: FileChange[];
  summary?: string;
}): Promise<void> {
  const { projectId, userId, source, files, summary } = opts;

  // Skip if no actual file changes
  if (files.length === 0) return;

  // Determine group_id
  let groupId: string;

  if (source === "edit" && userId) {
    // Check for recent edit by same user — reuse group if within 5 min
    const recent = await db.query.editHistory.findFirst({
      where: and(
        eq(schema.editHistory.projectId, projectId),
        eq(schema.editHistory.userId, userId),
        eq(schema.editHistory.source, "edit")
      ),
      orderBy: [desc(schema.editHistory.createdAt)],
    });

    if (recent) {
      const elapsed = Date.now() - new Date(recent.createdAt!).getTime();
      if (elapsed < GROUP_WINDOW_MS) {
        groupId = recent.groupId;
      } else {
        groupId = nanoid();
      }
    } else {
      groupId = nanoid();
    }
  } else {
    // Non-edit sources always get their own group
    groupId = nanoid();
  }

  // Create the history entry
  const historyId = nanoid();
  await db.insert(schema.editHistory).values({
    id: historyId,
    projectId,
    userId,
    source,
    summary: summary || null,
    groupId,
  });

  // Create file entries with unified diffs
  for (const file of files) {
    let unifiedDiff: string | null = null;

    if (file.diffType === "modify" && file.oldContent != null && file.newContent != null) {
      unifiedDiff = createPatch(
        file.path,
        file.oldContent,
        file.newContent,
        "",
        "",
        { context: 3 }
      );
    } else if (file.diffType === "create" && file.newContent != null) {
      unifiedDiff = createPatch(file.path, "", file.newContent, "", "", { context: 3 });
    } else if (file.diffType === "delete" && file.oldContent != null) {
      unifiedDiff = createPatch(file.path, file.oldContent, "", "", "", { context: 3 });
    }

    await db.insert(schema.editHistoryFiles).values({
      id: nanoid(),
      historyId,
      filePath: file.path,
      diffType: file.diffType,
      unifiedDiff,
    });
  }
}
