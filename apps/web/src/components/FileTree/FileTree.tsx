import { useState } from "react";
import type { FileEntry } from "@/lib/api";

interface Props {
  files: FileEntry[];
  activeFilePath: string | null;
  mainFile: string;
  onSelectFile: (path: string) => void;
  onCreateFile: (path: string, isDirectory?: boolean) => void;
  onDeleteFile: (path: string) => void;
  onSetMainFile: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
}

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];

  // Sort: dirs first, then alphabetical
  const sorted = [...files].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  for (const file of sorted) {
    const parts = file.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const existing = current.find((n) => n.name === name);

      if (existing) {
        current = existing.children;
      } else if (isLast) {
        current.push({
          name,
          path: file.path,
          isDirectory: file.isDirectory,
          children: [],
        });
      } else {
        const dir: TreeNode = {
          name,
          path: parts.slice(0, i + 1).join("/"),
          isDirectory: true,
          children: [],
        };
        current.push(dir);
        current = dir.children;
      }
    }
  }

  return root;
}

function FileTreeNode({
  node,
  depth,
  activeFilePath,
  mainFile,
  onSelectFile,
  onDeleteFile,
  onSetMainFile,
}: {
  node: TreeNode;
  depth: number;
  activeFilePath: string | null;
  mainFile: string;
  onSelectFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onSetMainFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isActive = node.path === activeFilePath;
  const isMain = node.path === mainFile;

  if (node.isDirectory) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1 rounded px-2 py-1 text-sm text-gray-400 hover:bg-gray-800"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <span className="text-xs">{expanded ? "▼" : "▶"}</span>
          <span>{node.name}</span>
        </button>
        {expanded &&
          node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              mainFile={mainFile}
              onSelectFile={onSelectFile}
              onDeleteFile={onDeleteFile}
              onSetMainFile={onSetMainFile}
            />
          ))}
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center justify-between rounded px-2 py-1 text-sm ${
        isActive
          ? "bg-blue-600/20 text-blue-300"
          : "text-gray-300 hover:bg-gray-800"
      }`}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
    >
      <button
        onClick={() => onSelectFile(node.path)}
        className="flex-1 truncate text-left"
      >
        {node.name}
        {isMain && (
          <span className="ml-1 text-xs text-yellow-500" title="Main file">
            *
          </span>
        )}
      </button>
      <div className="hidden gap-1 group-hover:flex">
        {!isMain && node.name.endsWith(".typ") && (
          <button
            onClick={() => onSetMainFile(node.path)}
            className="text-xs text-gray-500 hover:text-yellow-400"
            title="Set as main file"
          >
            M
          </button>
        )}
        <button
          onClick={() => {
            if (confirm(`Delete "${node.name}"?`)) onDeleteFile(node.path);
          }}
          className="text-xs text-gray-500 hover:text-red-400"
        >
          x
        </button>
      </div>
    </div>
  );
}

export function FileTree({
  files,
  activeFilePath,
  mainFile,
  onSelectFile,
  onCreateFile,
  onDeleteFile,
  onSetMainFile,
}: Props) {
  const [newFileName, setNewFileName] = useState("");
  const [showInput, setShowInput] = useState<false | "file" | "folder">(false);
  const tree = buildTree(files);

  const handleCreate = () => {
    if (!newFileName.trim()) return;
    const isDir = showInput === "folder";
    onCreateFile(newFileName.replace(/\/$/, ""), isDir);
    setNewFileName("");
    setShowInput(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Files
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => setShowInput(showInput === "folder" ? false : "folder")}
            className={`text-sm ${showInput === "folder" ? "text-blue-400" : "text-gray-500 hover:text-gray-300"}`}
            title="New folder"
          >
            📁
          </button>
          <button
            onClick={() => setShowInput(showInput === "file" ? false : "file")}
            className={`text-lg leading-none ${showInput === "file" ? "text-blue-400" : "text-gray-500 hover:text-gray-300"}`}
            title="New file"
          >
            +
          </button>
        </div>
      </div>

      {showInput && (
        <div className="border-b border-gray-800 p-2">
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setShowInput(false);
            }}
            placeholder={showInput === "folder" ? "folder name" : "filename.typ"}
            className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none"
            autoFocus
          />
        </div>
      )}

      <div className="flex-1 overflow-auto py-1">
        {tree.map((node) => (
          <FileTreeNode
            key={node.path}
            node={node}
            depth={0}
            activeFilePath={activeFilePath}
            mainFile={mainFile}
            onSelectFile={onSelectFile}
            onDeleteFile={onDeleteFile}
            onSetMainFile={onSetMainFile}
          />
        ))}
      </div>
    </div>
  );
}
