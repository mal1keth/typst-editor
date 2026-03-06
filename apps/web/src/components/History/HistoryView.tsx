import { useState, useEffect, useCallback, useRef } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { api, type HistoryGroup, type HistoryGroupDetail } from "@/lib/api";
import { HistoryTimeline } from "./HistoryTimeline";
import { HistoryDiffView } from "./HistoryDiffView";

interface Props {
  projectId: string;
  selectedFile: string | null;
  fileFilter?: string | null;
  onClearFileFilter?: () => void;
  onClose: () => void;
}

export function HistoryView({ projectId, selectedFile, fileFilter: externalFileFilter, onClearFileFilter: externalClearFilter, onClose }: Props) {
  const [groups, setGroups] = useState<HistoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupDetail, setGroupDetail] = useState<HistoryGroupDetail | null>(null);

  // The diff to display: match selectedFile against group detail entries
  const selectedDiff = groupDetail?.entries.find((e) => e.filePath === selectedFile) ?? null;

  // Load all history (no filter)
  const loadAllHistory = useCallback(() => {
    setLoading(true);
    api.history
      .list(projectId)
      .then((data) => {
        setGroups(data);
        if (data.length > 0) setSelectedGroupId(data[0].groupId);
      })
      .catch((err) => console.error("Failed to load history:", err))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Load per-file history
  const loadFileHistory = useCallback((filePath: string) => {
    setLoading(true);
    api.history
      .forFile(projectId, filePath)
      .then((entries) => {
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
  }, [projectId]);

  // React to external file filter changes
  const prevFilterRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevFilterRef.current === externalFileFilter) return;
    prevFilterRef.current = externalFileFilter;

    if (externalFileFilter) {
      loadFileHistory(externalFileFilter);
    } else {
      loadAllHistory();
    }
  }, [externalFileFilter, loadAllHistory, loadFileHistory]);

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
      })
      .catch((err) => console.error("Failed to load group detail:", err));
  }, [projectId, selectedGroupId]);

  const handleClearFileFilter = useCallback(() => {
    externalClearFilter?.();
    loadAllHistory();
  }, [loadAllHistory, externalClearFilter]);

  const handleSelectGroup = useCallback((groupId: string) => {
    setSelectedGroupId(groupId);
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

      {/* Two-panel layout: Diff viewer + Timeline */}
      <PanelGroup direction="horizontal" className="flex-1 overflow-hidden" autoSaveId="history-layout">
        {/* Left: Diff viewer */}
        <Panel id="history-diff" order={1} defaultSize={65} minSize={30}>
          <HistoryDiffView
            filePath={selectedFile}
            diffType={selectedDiff?.diffType ?? null}
            unifiedDiff={selectedDiff?.unifiedDiff ?? null}
          />
        </Panel>
        <PanelResizeHandle className="w-1 bg-gray-800 transition-colors hover:bg-blue-600" />

        {/* Right: Timeline */}
        <Panel id="history-timeline" order={2} defaultSize={35} minSize={20} maxSize={50}>
          <HistoryTimeline
            groups={groups}
            selectedGroupId={selectedGroupId}
            onSelectGroup={handleSelectGroup}
            loading={loading}
            fileFilter={externalFileFilter ?? null}
            onClearFileFilter={externalFileFilter ? handleClearFileFilter : undefined}
          />
        </Panel>
      </PanelGroup>
    </div>
  );
}
