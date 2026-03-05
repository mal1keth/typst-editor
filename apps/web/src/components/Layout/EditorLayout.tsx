import { useEffect, useCallback, useRef, useState, useMemo } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { ChangeSet } from "@codemirror/state";
import { EditorPanel } from "@/components/Editor/EditorPanel";
import { CompilerOutputPanel } from "@/components/Editor/CompilerOutputPanel";
import { PreviewPanel } from "@/components/Preview/PreviewPanel";
import { FileTree } from "@/components/FileTree/FileTree";
import { GitHubPanel } from "@/components/GitHub/GitHubPanel";
import { ShareDialog } from "@/components/Share/ShareDialog";
import { Toolbar } from "@/components/Layout/Toolbar";
import { useProjectStore } from "@/stores/projectStore";
import { useTypstCompiler, exportPdf, TYPST_VERSION } from "@/hooks/useTypstCompiler";
import {
  setupCollaboration,
  applyLocalChange,
  type CollabState,
} from "@/lib/collaboration/yjs-setup";

function getCookie(name: string): string {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? match[2] : "";
}

interface Props {
  projectId: string;
  onBack: () => void;
}

export function EditorLayout({ projectId, onBack }: Props) {
  const {
    currentProject,
    activeFilePath,
    loadingProject,
    savingFile,
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
  const [peerCount, setPeerCount] = useState(0);
  const [exportingPdf, setExportingPdf] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collabRef = useRef<CollabState | null>(null);
  const isRemoteUpdateRef = useRef(false);

  const [showCompilerOutput, setShowCompilerOutput] = useState(false);
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
    );

  // Persist compile mode
  useEffect(() => {
    localStorage.setItem('typst-compile-mode', compileMode);
  }, [compileMode]);

  // Keyboard shortcut: Ctrl+Enter / Cmd+Enter → compile
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

  useEffect(() => {
    loadProject(projectId);
  }, [projectId, loadProject]);

  // Set up collaboration when file changes
  useEffect(() => {
    if (!activeFilePath || !currentProject) return;

    if (collabRef.current) {
      collabRef.current.destroy();
      collabRef.current = null;
    }

    const token = getCookie("token");
    const collab = setupCollaboration(
      projectId,
      activeFilePath,
      contentRef.current || "",
      token,
      (content) => {
        isRemoteUpdateRef.current = true;
        contentRef.current = content;
        setActiveFileContent(content);
        isRemoteUpdateRef.current = false;
      },
      (conn, peers) => {
        setConnected(conn);
        setPeerCount(peers);
      }
    );

    collabRef.current = collab;

    return () => {
      collab.destroy();
      if (collabRef.current === collab) {
        collabRef.current = null;
      }
    };
  }, [projectId, activeFilePath]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback(
    (content: string, changes: ChangeSet) => {
      // Update ref immediately — compile hook reads this, no re-render triggered.
      // Do NOT call setActiveFileContent() here — it triggers a Zustand broadcast
      // that re-renders the entire EditorLayout tree on every keystroke.
      contentRef.current = content;
      typingUntilRef.current = Date.now() + 300;

      if (compileMode === 'live') {
        triggerCompile();
      }

      if (collabRef.current && !isRemoteUpdateRef.current) {
        applyLocalChange(collabRef.current, changes);
      }

      // Debounced save — syncs store + persists to server after 1.5s of inactivity
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        if (activeFilePath) {
          setActiveFileContent(content);
          saveFile(activeFilePath, content);
        }
      }, 1500);
    },
    [activeFilePath, saveFile, setActiveFileContent, triggerCompile, compileMode]
  );

  const handleShare = useCallback(() => setShowShare(true), []);
  const handleToggleGitHub = useCallback(() => setShowGitHub(prev => !prev), []);
  const handleToggleCompilerOutput = useCallback(() => setShowCompilerOutput(prev => !prev), []);
  const handleCreateFile = useCallback(
    (path: string, isDir?: boolean) => createFile(path, isDir ? undefined : "", isDir),
    [createFile]
  );

  const handleExportPdf = useCallback(async () => {
    if (!contentRef.current || !currentProject) return;
    setExportingPdf(true);
    try {
      await exportPdf(
        projectId,
        currentProject.mainFile,
        currentProject.mainFile,
      );
    } catch (e: any) {
      alert(`PDF export failed: ${e.message}`);
    } finally {
      setExportingPdf(false);
    }
  }, [currentProject, projectId]);

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
        onBack={onBack}
        onShare={handleShare}
        onExportPdf={handleExportPdf}
        exportingPdf={exportingPdf}
        onGitHub={handleToggleGitHub}
        onCompilerOutput={handleToggleCompilerOutput}
        onCompileModeChange={setCompileMode}
        onCompile={triggerCompile}
      />

      <PanelGroup direction="horizontal" className="flex-1 overflow-hidden" autoSaveId="editor-layout">
        {/* Sidebar */}
        {!sidebarCollapsed && (
          <>
            <Panel id="sidebar" order={1} defaultSize={15} minSize={10} maxSize={30}>
              <div className="flex h-full flex-col border-r border-gray-800 bg-gray-900">
                <div className="flex-1 overflow-hidden">
                  {showGitHub ? (
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
                      onSelectFile={openFile}
                      onCreateFile={handleCreateFile}
                      onDeleteFile={deleteFile}
                      onSetMainFile={updateMainFile}
                    />
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-gray-800 px-3 py-2 text-xs text-gray-500">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-gray-600">Typst {TYPST_VERSION.label}</span>
                    <span>
                      <span
                        className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                          connected ? "bg-green-500" : "bg-gray-600"
                        }`}
                      />
                      {connected
                        ? peerCount > 1
                          ? `${peerCount - 1} peer${peerCount - 1 !== 1 ? "s" : ""}`
                          : "Connected"
                        : "Offline"}
                    </span>
                  </div>
                  <button
                    onClick={() => setSidebarCollapsed(true)}
                    className="text-gray-600 hover:text-gray-300"
                    title="Collapse sidebar"
                  >
                    ◀
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
              ▶
            </button>
          </div>
        )}

        {/* Editor + Preview */}
        {activeFilePath ? (
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

      {showShare && (
        <ShareDialog
          projectId={projectId}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  );
}
