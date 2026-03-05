import { useEffect, useCallback, useRef, useState } from "react";
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
import { useTypstCompiler, exportPdf, getSelectedVersion } from "@/hooks/useTypstCompiler";
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
    activeFileContent,
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
  const [compilerVersion, setCompilerVersion] = useState(getSelectedVersion);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collabRef = useRef<CollabState | null>(null);
  const isRemoteUpdateRef = useRef(false);

  const [showCompilerOutput, setShowCompilerOutput] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Canvas container ref for the typst.ts renderer
  const previewContainerRef = useRef<HTMLDivElement>(null);

  const compileContent = activeFileContent || "";
  const allFiles = currentProject?.files || [];

  const { error, compiling, diagnostics, clearDiagnostics, pages, triggerCompile } =
    useTypstCompiler(
      projectId,
      activeFilePath,
      compileContent,
      allFiles,
      compilerVersion,
      previewContainerRef,
      currentProject?.mainFile,
    );

  useEffect(() => {
    loadProject(projectId);
  }, [projectId, loadProject]);

  // Set up collaboration when file changes
  useEffect(() => {
    if (!activeFilePath || !currentProject) return;

    // Clean up previous collaboration
    if (collabRef.current) {
      collabRef.current.destroy();
      collabRef.current = null;
    }

    const token = getCookie("token");
    const collab = setupCollaboration(
      projectId,
      activeFilePath,
      activeFileContent || "",
      token,
      (content) => {
        // Remote update received
        isRemoteUpdateRef.current = true;
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
      setActiveFileContent(content);

      // Trigger recompilation
      triggerCompile();

      // Send diff-based update to collaborators (not full content)
      if (collabRef.current && !isRemoteUpdateRef.current) {
        applyLocalChange(collabRef.current, changes);
      }

      // Auto-save after 1.5s of inactivity
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        if (activeFilePath) {
          saveFile(activeFilePath, content);
        }
      }, 1500);
    },
    [activeFilePath, saveFile, setActiveFileContent, triggerCompile]
  );

  const handleExportPdf = useCallback(async () => {
    if (!activeFileContent || !currentProject) return;
    setExportingPdf(true);
    try {
      await exportPdf(
        projectId,
        currentProject.files,
        currentProject.mainFile,
        currentProject.mainFile,
        compilerVersion
      );
    } catch (e: any) {
      alert(`PDF export failed: ${e.message}`);
    } finally {
      setExportingPdf(false);
    }
  }, [activeFileContent, currentProject, compilerVersion, projectId]);

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
        compilerVersion={compilerVersion}
        errorCount={error ? 1 : 0}
        showingCompilerOutput={showCompilerOutput}
        onBack={onBack}
        onShare={() => setShowShare(true)}
        onExportPdf={handleExportPdf}
        exportingPdf={exportingPdf}
        onGitHub={() => setShowGitHub(!showGitHub)}
        onVersionChange={setCompilerVersion}
        onCompilerOutput={() => setShowCompilerOutput(!showCompilerOutput)}
      />

      <PanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        {/* Sidebar */}
        {!sidebarCollapsed && (
          <>
            <Panel defaultSize={15} minSize={10} maxSize={30}>
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
                      onCreateFile={(path, isDir) =>
                        createFile(path, isDir ? undefined : "", isDir)
                      }
                      onDeleteFile={deleteFile}
                      onSetMainFile={updateMainFile}
                    />
                  )}
                </div>
                {/* Collaboration status + collapse */}
                <div className="flex items-center justify-between border-t border-gray-800 px-3 py-2 text-xs text-gray-500">
                  <span>
                    <span
                      className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                        connected ? "bg-green-500" : "bg-gray-600"
                      }`}
                    />
                    {connected ? `${peerCount} connected` : "Offline"}
                  </span>
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

        {/* Collapsed sidebar toggle */}
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
            <Panel defaultSize={42} minSize={20}>
              <PanelGroup direction="vertical">
                <Panel defaultSize={showCompilerOutput ? 70 : 100} minSize={30}>
                  <EditorPanel
                    key={activeFilePath}
                    initialContent={activeFileContent || ""}
                    onChange={handleChange}
                  />
                </Panel>
                {showCompilerOutput && (
                  <>
                    <PanelResizeHandle className="h-1 bg-gray-800 transition-colors hover:bg-blue-600" />
                    <Panel defaultSize={30} minSize={15}>
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
            <Panel defaultSize={42} minSize={20}>
              <PreviewPanel
                containerRef={previewContainerRef}
                error={error}
                compiling={compiling}
                pages={pages}
              />
            </Panel>
          </>
        ) : (
          <Panel defaultSize={85}>
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
