import { useEffect, useCallback, useRef, useState, useMemo } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { ChangeSet } from "@codemirror/state";
import { EditorPanel } from "@/components/Editor/EditorPanel";
import { CompilerOutputPanel } from "@/components/Editor/CompilerOutputPanel";
import { PreviewPanel } from "@/components/Preview/PreviewPanel";
import { FileTree } from "@/components/FileTree/FileTree";
import { GitHubPanel } from "@/components/GitHub/GitHubPanel";
import { ShareDialog } from "@/components/Share/ShareDialog";
import { HistoryView } from "@/components/History/HistoryView";
import { Toolbar } from "@/components/Layout/Toolbar";
import { useProjectStore } from "@/stores/projectStore";
import { useTypstCompiler, exportPdf, TYPST_VERSION } from "@/hooks/useTypstCompiler";
import { api } from "@/lib/api";
import {
  setupCollaboration,
  applyLocalChange,
  type CollabState,
  type PresenceUser,
} from "@/lib/collaboration/yjs-setup";

interface Props {
  projectId: string;
  shareToken?: string;
  onBack: () => void;
}

export function EditorLayout({ projectId, shareToken, onBack }: Props) {
  const {
    currentProject,
    activeFilePath,
    loadingProject,
    savingFile,
    readOnly,
    loadProject,
    openFile,
    saveFile,
    createFile,
    deleteFile,
    setActiveFileContent,
    updateMainFile,
  } = useProjectStore();

  const [showGitHub, setShowGitHub] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [connected, setConnected] = useState(false);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [exportingPdf, setExportingPdf] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collabRef = useRef<CollabState | null>(null);
  const isRemoteUpdateRef = useRef(false);

  const [showCompilerOutput, setShowCompilerOutput] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [compileMode, setCompileMode] = useState<'live' | 'manual'>(() =>
    (localStorage.getItem('typst-compile-mode') as 'live' | 'manual') || 'manual'
  );

  const allFiles = currentProject?.files || [];

  // Content ref — always has the latest file content, updated by handleChange.
  // Read by the compile hook without triggering re-renders.
  const contentRef = useRef<string | null>(null);
  // Tracks when the user last typed — compile hook defers rendering until this passes
  const typingUntilRef = useRef(0);

  // Stable initial content — only recomputes when switching files.
  const editorInitialContent = useMemo(() => {
    const content = useProjectStore.getState().activeFileContent;
    contentRef.current = content;
    return content || "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilePath]);

  const { error, compiling, diagnostics, clearDiagnostics, pages, artifactContent, renderer, triggerCompile } =
    useTypstCompiler(
      projectId,
      activeFilePath,
      contentRef,
      allFiles,
      currentProject?.mainFile,
      typingUntilRef,
      shareToken,
    );

  // Persist compile mode
  useEffect(() => {
    localStorage.setItem('typst-compile-mode', compileMode);
  }, [compileMode]);

  // Keyboard shortcut: Ctrl+Enter / Cmd+Enter -> compile
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        triggerCompile();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [triggerCompile]);

  const [autoPullStatus, setAutoPullStatus] = useState<string | null>(null);

  useEffect(() => {
    loadProject(projectId, shareToken);
  }, [projectId, shareToken, loadProject]);

  // Auto-pull from GitHub if project is linked and remote has new commits
  useEffect(() => {
    if (shareToken || !currentProject?.githubRepoFullName) return;

    let cancelled = false;

    (async () => {
      try {
        const result = await api.github.autoPull(projectId);
        if (cancelled) return;

        if (result.pulled) {
          setAutoPullStatus(`Pulled ${result.fileCount} files from GitHub`);
          // Reload the project to pick up new files
          await loadProject(projectId);
          // Clear the status after a few seconds
          setTimeout(() => {
            if (!cancelled) setAutoPullStatus(null);
          }, 4000);
        }
      } catch {
        // Silent failure — auto-pull is best-effort
      }
    })();

    return () => { cancelled = true; };
  }, [projectId, currentProject?.githubRepoFullName, shareToken, loadProject]);

  // Flush pending save immediately (called before file switch / history toggle)
  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      // Save whatever is in contentRef right now
      const path = useProjectStore.getState().activeFilePath;
      const content = contentRef.current;
      if (path && content !== null && !readOnly) {
        setActiveFileContent(content);
        saveFile(path, content);
      }
    }
  }, [saveFile, setActiveFileContent, readOnly]);

  // Set up collaboration when file changes (skip for anonymous share access)
  useEffect(() => {
    if (!activeFilePath || !currentProject || shareToken) return;

    // Flush any pending save from the previous file
    flushSave();

    if (collabRef.current) {
      collabRef.current.destroy();
      collabRef.current = null;
    }

    const collab = setupCollaboration(
      projectId,
      activeFilePath,
      contentRef.current || "",
      (content) => {
        isRemoteUpdateRef.current = true;
        contentRef.current = content;
        setActiveFileContent(content);
        isRemoteUpdateRef.current = false;
      },
      (conn) => {
        setConnected(conn);
      },
      (users) => {
        setPresenceUsers(users);
      },
    );

    collabRef.current = collab;

    return () => {
      collab.destroy();
      if (collabRef.current === collab) {
        collabRef.current = null;
      }
    };
  }, [projectId, activeFilePath, shareToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback(
    (content: string, changes: ChangeSet) => {
      contentRef.current = content;
      typingUntilRef.current = Date.now() + 300;

      if (compileMode === 'live') {
        triggerCompile();
      }

      if (collabRef.current && !isRemoteUpdateRef.current) {
        applyLocalChange(collabRef.current, changes);
      }

      // Debounced save (skip for read-only)
      if (!readOnly) {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          if (activeFilePath) {
            setActiveFileContent(content);
            saveFile(activeFilePath, content);
          }
        }, 1500);
      }
    },
    [activeFilePath, saveFile, setActiveFileContent, triggerCompile, compileMode, readOnly]
  );

  const handleOpenFile = useCallback((path: string) => {
    flushSave();
    openFile(path);
  }, [flushSave, openFile]);

  const handleShare = useCallback(() => setShowShare(true), []);
  const handleToggleGitHub = useCallback(() => setShowGitHub(prev => !prev), []);
  const handleToggleCompilerOutput = useCallback(() => setShowCompilerOutput(prev => !prev), []);
  const handleToggleHistory = useCallback(() => {
    flushSave();
    setShowHistory(prev => !prev);
  }, [flushSave]);
  const handleCreateFile = useCallback(
    (path: string, isDir?: boolean) => createFile(path, isDir ? undefined : "", isDir),
    [createFile]
  );

  const handleDownloadFile = useCallback(
    (path: string) => api.files.download(projectId, path),
    [projectId]
  );

  const handleExportPdf = useCallback(async () => {
    if (!currentProject) return;
    setExportingPdf(true);
    try {
      await exportPdf(
        projectId,
        currentProject.mainFile,
        currentProject.mainFile,
        activeFilePath,
        contentRef.current,
      );
    } catch (e: any) {
      alert(`PDF export failed: ${e.message}`);
    } finally {
      setExportingPdf(false);
    }
  }, [currentProject, projectId, activeFilePath]);

  if (loadingProject || !currentProject) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-gray-400">
        Loading project...
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-gray-950">
      <Toolbar
        projectName={currentProject.name}
        saving={savingFile}
        githubLinked={!!currentProject.githubRepoFullName}
        errorCount={error ? 1 : 0}
        showingCompilerOutput={showCompilerOutput}
        compileMode={compileMode}
        compiling={compiling}
        readOnly={readOnly}
        autoPullStatus={autoPullStatus}
        onBack={onBack}
        onShare={handleShare}
        onExportPdf={handleExportPdf}
        exportingPdf={exportingPdf}
        onGitHub={handleToggleGitHub}
        onCompilerOutput={handleToggleCompilerOutput}
        onCompileModeChange={setCompileMode}
        onCompile={triggerCompile}
        onHistory={!readOnly ? handleToggleHistory : undefined}
      />

      <PanelGroup direction="horizontal" className="flex-1 overflow-hidden" autoSaveId="editor-layout">
        {/* Sidebar */}
        {!sidebarCollapsed && (
          <>
            <Panel id="sidebar" order={1} defaultSize={15} minSize={10} maxSize={30}>
              <div className="flex h-full flex-col border-r border-gray-800 bg-gray-900">
                <div className="flex-1 overflow-hidden">
                  {showGitHub && !readOnly ? (
                    <GitHubPanel
                      projectId={projectId}
                      onClose={() => setShowGitHub(false)}
                      onPullComplete={() => loadProject(projectId)}
                    />
                  ) : (
                    <FileTree
                      files={currentProject.files}
                      activeFilePath={activeFilePath}
                      mainFile={currentProject.mainFile}
                      onSelectFile={handleOpenFile}
                      onDownloadFile={handleDownloadFile}
                      {...(!readOnly && {
                        onCreateFile: handleCreateFile,
                        onDeleteFile: deleteFile,
                        onSetMainFile: updateMainFile,
                      })}
                    />
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-gray-800 px-3 py-2 text-xs text-gray-500">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-gray-600">Typst {TYPST_VERSION.label}</span>
                      {readOnly ? (
                        <span className="text-yellow-500">Read only</span>
                      ) : (
                        <span>
                          <span
                            className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                              connected ? "bg-green-500" : "bg-gray-600"
                            }`}
                          />
                          {connected ? "Connected" : "Offline"}
                        </span>
                      )}
                    </div>
                    {/* Presence avatars */}
                    {presenceUsers.length > 1 && (
                      <div className="flex -space-x-1.5">
                        {presenceUsers.map((u) => (
                          <div
                            key={u.userId}
                            className="group relative"
                          >
                            {u.avatarUrl ? (
                              <img
                                src={u.avatarUrl}
                                alt={u.displayName}
                                className="h-5 w-5 rounded-full border border-gray-700 object-cover"
                              />
                            ) : (
                              <div className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-medium ${
                                u.anonymous
                                  ? "border-gray-600 bg-gray-800 text-gray-500"
                                  : "border-gray-700 bg-gray-700 text-gray-300"
                              }`}>
                                {u.anonymous ? "A" : u.displayName.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-[10px] text-gray-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                              {u.displayName}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setSidebarCollapsed(true)}
                    className="text-gray-600 hover:text-gray-300"
                    title="Collapse sidebar"
                  >
                    &#9664;
                  </button>
                </div>
              </div>
            </Panel>
            <PanelResizeHandle className="w-1 bg-gray-800 transition-colors hover:bg-blue-600" />
          </>
        )}

        {sidebarCollapsed && (
          <div className="flex flex-col items-center border-r border-gray-800 bg-gray-900 py-2">
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="px-1.5 py-1 text-xs text-gray-500 hover:text-gray-300"
              title="Expand sidebar"
            >
              &#9654;
            </button>
          </div>
        )}

        {/* Main content area: History view OR Editor + Preview */}
        {showHistory ? (
          <Panel id="history-view" order={2} defaultSize={85}>
            <HistoryView
              projectId={projectId}
              onClose={() => setShowHistory(false)}
            />
          </Panel>
        ) : activeFilePath ? (
          <>
            <Panel id="editor" order={2} defaultSize={42} minSize={20}>
              <PanelGroup direction="vertical" autoSaveId="editor-vertical">
                <Panel id="editor-code" order={1} defaultSize={showCompilerOutput ? 70 : 100} minSize={30}>
                  <EditorPanel
                    key={activeFilePath}
                    initialContent={editorInitialContent}
                    onChange={handleChange}
                  />
                </Panel>
                {showCompilerOutput && (
                  <>
                    <PanelResizeHandle className="h-1 bg-gray-800 transition-colors hover:bg-blue-600" />
                    <Panel id="compiler-output" order={2} defaultSize={30} minSize={15}>
                      <CompilerOutputPanel
                        diagnostics={diagnostics}
                        currentError={error}
                        onClear={clearDiagnostics}
                        onClose={() => setShowCompilerOutput(false)}
                      />
                    </Panel>
                  </>
                )}
              </PanelGroup>
            </Panel>
            <PanelResizeHandle className="w-1 bg-gray-800 transition-colors hover:bg-blue-600" />
            <Panel id="preview" order={3} defaultSize={42} minSize={20}>
              <PreviewPanel
                error={error}
                compiling={compiling}
                pages={pages}
                artifactContent={artifactContent}
                renderer={renderer}
              />
            </Panel>
          </>
        ) : (
          <Panel id="editor" order={2} defaultSize={85}>
            <div className="flex h-full items-center justify-center text-gray-500">
              Select a file to edit
            </div>
          </Panel>
        )}
      </PanelGroup>

      {showShare && !readOnly && (
        <ShareDialog
          projectId={projectId}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  );
}
