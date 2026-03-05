import { useState, useRef, useEffect } from "react";
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

// Retro-style SVG icons
function FolderIcon({ open }: { open?: boolean }) {
  return open ? (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M1 3h5l2 2h7v1H3l-2 7V3z" fill="#b08c3e" />
      <path d="M1 6l2 7h11l2-7H1z" fill="#d4a843" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M1 2h5l2 2h7v10H1V2z" fill="#b08c3e" />
      <path d="M1 4h14v8H1V4z" fill="#d4a843" />
    </svg>
  );
}

function FileIcon({ isMain }: { isMain?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M3 1h7l3 3v11H3V1z" fill={isMain ? "#5a4a1e" : "#374151"} />
      <path d="M4 2h5.5L12 4.5V14H4V2z" fill={isMain ? "#d4a843" : "#6b7280"} />
      <path d="M10 1v3h3" fill="none" stroke={isMain ? "#b08c3e" : "#4b5563"} strokeWidth="0.5" />
    </svg>
  );
}

function NewFolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M1 3h5l2 2h7v9H1V3z" fill="#6b7280" />
      <path d="M8 8v4M6 10h4" stroke="#d1d5db" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// Context menu component
function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: { label: string; onClick: () => void; danger?: boolean }[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[140px] rounded border border-gray-700 bg-gray-900 py-1 shadow-xl"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => {
            item.onClick();
            onClose();
          }}
          className={`block w-full px-3 py-1.5 text-left text-xs ${
            item.danger
              ? "text-red-400 hover:bg-red-900/30"
              : "text-gray-300 hover:bg-gray-800"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
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
  onContextMenu,
}: {
  node: TreeNode;
  depth: number;
  activeFilePath: string | null;
  mainFile: string;
  onSelectFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onSetMainFile: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isActive = node.path === activeFilePath;
  const isMain = node.path === mainFile;

  if (node.isDirectory) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          onContextMenu={(e) => onContextMenu(e, node)}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-sm text-gray-400 hover:bg-gray-800"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <FolderIcon open={expanded} />
          <span className="truncate">{node.name}</span>
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
              onContextMenu={onContextMenu}
            />
          ))}
      </div>
    );
  }

  const showSetMain = !isMain && node.name.endsWith(".typ");

  return (
    <div
      className={`group flex items-center justify-between rounded px-2 py-1 text-sm ${
        isActive
          ? "bg-blue-600/20 text-blue-300"
          : "text-gray-300 hover:bg-gray-800"
      }`}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
      onContextMenu={(e) => onContextMenu(e, node)}
    >
      <button
        onClick={() => onSelectFile(node.path)}
        className="flex flex-1 items-center gap-1.5 truncate text-left"
      >
        <FileIcon isMain={isMain} />
        <span className="truncate">{node.name}</span>
      </button>
      {showSetMain && (
        <button
          onClick={(e) => { e.stopPropagation(); onSetMainFile(node.path); }}
          className={`ml-1 shrink-0 rounded px-1 py-0.5 font-mono text-[10px] leading-none ${
            isActive
              ? "text-gray-400 hover:text-yellow-400"
              : "hidden text-gray-600 hover:text-yellow-400 group-hover:block"
          }`}
          title="Set as main compile file"
        >
          M
        </button>
      )}
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
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: TreeNode;
  } | null>(null);
  const tree = buildTree(files);

  const handleCreate = () => {
    if (!newFileName.trim()) return;
    const isDir = showInput === "folder";
    onCreateFile(newFileName.replace(/\/$/, ""), isDir);
    setNewFileName("");
    setShowInput(false);
  };

  const handleContextMenu = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  const contextMenuItems = contextMenu
    ? [
        ...(!contextMenu.node.isDirectory && contextMenu.node.name.endsWith(".typ") && contextMenu.node.path !== mainFile
          ? [
              {
                label: "Set as main file",
                onClick: () => onSetMainFile(contextMenu.node.path),
              },
            ]
          : []),
        {
          label: "Delete",
          onClick: () => {
            if (confirm(`Delete "${contextMenu.node.name}"?`))
              onDeleteFile(contextMenu.node.path);
          },
          danger: true,
        },
      ]
    : [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Files
        </span>
        <div className="flex gap-1">
          <button
            onClick={() =>
              setShowInput(showInput === "folder" ? false : "folder")
            }
            className={`${showInput === "folder" ? "text-blue-400" : "text-gray-500 hover:text-gray-300"}`}
            title="New folder"
          >
            <NewFolderIcon />
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
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
