import { memo, useMemo } from "react";
import type { HistoryGroup } from "@/lib/api";

interface Props {
  groups: HistoryGroup[];
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
  loading: boolean;
  fileFilter: string | null;
  onClearFileFilter?: () => void;
}

function timeAgo(dateStr: string): string {
  // SQLite datetime('now') stores UTC without a Z suffix — append it so JS parses as UTC
  const date = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function sourceLabel(source: string): { text: string; className: string } {
  switch (source) {
    case "github_pull":
      return { text: "GitHub Pull", className: "bg-purple-900/50 text-purple-300" };
    case "file_create":
      return { text: "New File", className: "bg-green-900/50 text-green-300" };
    case "file_delete":
      return { text: "Deleted", className: "bg-red-900/50 text-red-300" };
    default:
      return { text: "Edit", className: "bg-gray-800 text-gray-400" };
  }
}

function diffTypeIcon(diffType: string) {
  switch (diffType) {
    case "create": return { char: "+", className: "text-green-400" };
    case "delete": return { char: "−", className: "text-red-400" };
    default: return { char: "~", className: "text-blue-400" };
  }
}

export const HistoryTimeline = memo(function HistoryTimeline({
  groups,
  selectedGroupId,
  onSelectGroup,
  loading,
  fileFilter,
  onClearFileFilter,
}: Props) {
  // Group entries by day
  const dayGroups = useMemo(() => {
    const days = new Map<string, HistoryGroup[]>();
    for (const g of groups) {
      const raw = g.lastEditAt || g.createdAt;
      const day = new Date(raw.endsWith("Z") ? raw : raw + "Z").toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      const existing = days.get(day);
      if (existing) existing.push(g);
      else days.set(day, [g]);
    }
    return Array.from(days.entries());
  }, [groups]);

  return (
    <div className="flex h-full flex-col bg-gray-900">
      <div className="border-b border-gray-800 px-3 py-2">
        <span className="text-xs font-medium text-gray-400">
          {fileFilter ? (
            <>
              History for <span className="text-gray-200">{fileFilter}</span>
              {onClearFileFilter && (
                <button
                  onClick={onClearFileFilter}
                  className="ml-2 text-blue-400 hover:text-blue-300"
                >
                  Show all
                </button>
              )}
            </>
          ) : (
            "Edit History"
          )}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8 text-sm text-gray-500">
            Loading history...
          </div>
        )}
        {!loading && groups.length === 0 && (
          <div className="flex items-center justify-center py-8 text-sm text-gray-500">
            No edit history yet
          </div>
        )}
        {dayGroups.map(([day, entries]) => (
          <div key={day}>
            <div className="sticky top-0 z-10 bg-gray-900/95 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-500 backdrop-blur-sm border-b border-gray-800/50">
              {day}
            </div>
            {entries.map((group) => {
              const badge = sourceLabel(group.source);
              const isSelected = selectedGroupId === group.groupId;

              return (
                <div
                  key={group.groupId}
                  className={`cursor-pointer border-b border-gray-800/50 px-3 py-2 transition-colors ${
                    isSelected ? "bg-blue-900/20" : "hover:bg-gray-800/50"
                  }`}
                  onClick={() => onSelectGroup(group.groupId)}
                >
                  <div className="flex items-center gap-2">
                    {/* Avatar */}
                    {group.avatarUrl ? (
                      <img
                        src={group.avatarUrl}
                        alt={group.displayName}
                        className="h-5 w-5 flex-shrink-0 rounded-full"
                      />
                    ) : (
                      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-gray-700 text-[10px] font-medium text-gray-300">
                        {group.displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="flex-1 truncate text-sm text-gray-200">
                      {group.displayName}
                    </span>
                    <span className="flex-shrink-0 text-[10px] text-gray-500">
                      {timeAgo(group.lastEditAt || group.createdAt)}
                    </span>
                  </div>

                  {/* Source badge + summary */}
                  <div className="mt-1 ml-7 flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
                      {badge.text}
                    </span>
                    {group.summary && (
                      <span className="truncate text-xs text-gray-400">{group.summary}</span>
                    )}
                  </div>

                  {/* Changed files — plain text list */}
                  <div className="mt-1 ml-7 flex flex-wrap gap-x-2 gap-y-0.5">
                    {group.changedFiles.slice(0, 6).map((f) => {
                      const icon = diffTypeIcon(f.diffType);
                      return (
                        <span
                          key={f.path}
                          className="flex items-center gap-1 text-[11px] text-gray-500"
                        >
                          <span className={`font-mono text-[10px] ${icon.className}`}>{icon.char}</span>
                          <span>{f.path.split("/").pop()}</span>
                        </span>
                      );
                    })}
                    {group.changedFiles.length > 6 && (
                      <span className="text-[10px] text-gray-600">
                        +{group.changedFiles.length - 6} more
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});
