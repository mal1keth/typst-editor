import { useState, useEffect, useCallback } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { api, type HistoryGroup, type HistoryGroupDetail } from "@/lib/api";
import { HistoryTimeline } from "./HistoryTimeline";
import { HistoryFileTree } from "./HistoryFileTree";
import { HistoryDiffView } from "./HistoryDiffView";

interface Props {
  projectId: string;
  onClose: () => void;
}

export function HistoryView({ projectId, onClose }: Props) {
  const [groups, setGroups] = useState<HistoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupDetail, setGroupDetail] = useState<HistoryGroupDetail | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileFilter, setFileFilter] = useState<string | null>(null);

  // Selected file's diff from the group detail
  const selectedDiff = groupDetail?.entries.find((e) => e.filePath === selectedFile) ?? null;

  // Load history groups
  useEffect(() => {
    setLoading(true);
    api.history
      .list(projectId)
      .then((data) => {
        setGroups(data);
        // Auto-select first group
        if (data.length > 0) {
          setSelectedGroupId(data[0].groupId);
        }
      })
      .catch((err) => console.error("Failed to load history:", err))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Load group detail when selection changes
  useEffect(() => {
    if (!selectedGroupId) {
      setGroupDetail(null);
      return;
    }
    api.history
      .group(projectId, selectedGroupId)
      .then((data) => {
        setGroupDetail(data);
        // Auto-select first file
        if (data.entries.length > 0) {
          setSelectedFile(data.entries[0].filePath);
        } else {
          setSelectedFile(null);
        }
      })
      .catch((err) => console.error("Failed to load group detail:", err));
  }, [projectId, selectedGroupId]);

  // Per-file history
  const handleFileHistory = useCallback(
    (filePath: string) => {
      setFileFilter(filePath);
      setLoading(true);
      api.history
        .forFile(projectId, filePath)
        .then((entries) => {
          // Convert file entries to group format for the timeline
          const fileGroups: HistoryGroup[] = entries.map((e) => ({
            groupId: e.groupId,
            userId: e.userId,
            displayName: e.displayName,
            avatarUrl: e.avatarUrl,
            source: e.source as any,
            summary: null,
            changedFiles: [{ path: filePath, diffType: e.diffType }],
            createdAt: e.createdAt,
            lastEditAt: e.createdAt,
          }));
          setGroups(fileGroups);
          if (fileGroups.length > 0) {
            setSelectedGroupId(fileGroups[0].groupId);
          }
        })
        .catch((err) => console.error("Failed to load file history:", err))
        .finally(() => setLoading(false));
    },
    [projectId]
  );

  const handleClearFileFilter = useCallback(() => {
    setFileFilter(null);
    setLoading(true);
    api.history
      .list(projectId)
      .then((data) => {
        setGroups(data);
        if (data.length > 0) setSelectedGroupId(data[0].groupId);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleSelectGroup = useCallback((groupId: string) => {
    setSelectedGroupId(groupId);
  }, []);

  const handleSelectFile = useCallback((path: string) => {
    setSelectedFile(path);
  }, []);

  return (
    <div className="flex h-full flex-col bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-sm text-gray-400 hover:text-gray-200"
          >
            &larr; Back to Editor
          </button>
          <span className="text-gray-600">|</span>
          <h2 className="text-sm font-medium text-gray-200">Edit History</h2>
        </div>
      </div>

      {/* Three-panel layout */}
      <PanelGroup direction="horizontal" className="flex-1 overflow-hidden" autoSaveId="history-layout">
        {/* Left: Changed files */}
        <Panel id="history-files" order={1} defaultSize={18} minSize={12} maxSize={30}>
          <HistoryFileTree
            files={
              groupDetail?.entries.map((e) => ({
                path: e.filePath,
                diffType: e.diffType,
              })) ?? []
            }
            selectedFile={selectedFile}
            onSelectFile={handleSelectFile}
            onFileHistory={handleFileHistory}
          />
        </Panel>
        <PanelResizeHandle className="w-1 bg-gray-800 transition-colors hover:bg-blue-600" />

        {/* Middle: Diff viewer */}
        <Panel id="history-diff" order={2} defaultSize={55} minSize={30}>
          <HistoryDiffView
            filePath={selectedFile}
            diffType={selectedDiff?.diffType ?? null}
            unifiedDiff={selectedDiff?.unifiedDiff ?? null}
          />
        </Panel>
        <PanelResizeHandle className="w-1 bg-gray-800 transition-colors hover:bg-blue-600" />

        {/* Right: Timeline */}
        <Panel id="history-timeline" order={3} defaultSize={27} minSize={18} maxSize={40}>
          <HistoryTimeline
            groups={groups}
            selectedGroupId={selectedGroupId}
            onSelectGroup={handleSelectGroup}
            loading={loading}
            fileFilter={fileFilter}
            onClearFileFilter={fileFilter ? handleClearFileFilter : undefined}
          />
        </Panel>
      </PanelGroup>
    </div>
  );
}
