import { useState, useEffect, useRef, useCallback, useMemo, startTransition } from "react";
import {
  createTypstRenderer,
  type TypstRenderer,
} from "@myriaddreamin/typst.ts";
import type { PageInfo } from "@myriaddreamin/typst.ts/dist/esm/internal.types.mjs";
import type { FileEntry } from "@/lib/api";

// Supported compiler versions
export const TYPST_VERSIONS = [
  { pkg: "0.7.0-rc2", label: "0.14" },
  { pkg: "0.6.0", label: "0.13" },
  { pkg: "0.5.4", label: "0.12" },
  { pkg: "0.5.0", label: "0.11" },
  { pkg: "0.4.1", label: "0.10" },
] as const;

const STORAGE_KEY = "typst-compiler-version";
const DEFAULT_VERSION = TYPST_VERSIONS[0].pkg;

export function getSelectedVersion(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && TYPST_VERSIONS.some((v) => v.pkg === stored)) return stored;
  return DEFAULT_VERSION;
}

export function setSelectedVersion(pkg: string) {
  localStorage.setItem(STORAGE_KEY, pkg);
}

function wasmUrl(pkg: string, name: string) {
  return `https://cdn.jsdelivr.net/npm/@myriaddreamin/${name}@${pkg}/pkg/${name.replace(/-/g, "_")}_bg.wasm`;
}

export interface CompilerDiagnostic {
  severity: "error" | "warning";
  message: string;
  timestamp: number;
}

export interface CompilerState {
  error: string | null;
  compiling: boolean;
  diagnostics: CompilerDiagnostic[];
  pages: PageInfo[];
}

// ---------------------------------------------------------------------------
// Renderer cache — stays on main thread for canvas rendering
// ---------------------------------------------------------------------------
const rendererCache = new Map<string, Promise<TypstRenderer>>();

async function getRenderer(version: string): Promise<TypstRenderer> {
  const cached = rendererCache.get(version);
  if (cached) return cached;

  const promise = (async () => {
    const renderer = createTypstRenderer();
    await renderer.init({
      getModule: () => wasmUrl(version, "typst-ts-renderer"),
    });
    return renderer;
  })();

  rendererCache.set(version, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Web Worker client — compilation runs off the main thread
// ---------------------------------------------------------------------------
let workerInstance: Worker | null = null;
let workerPending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let workerNextId = 0;

function getWorker(): Worker {
  if (workerInstance) return workerInstance;

  workerInstance = new Worker(
    new URL("../workers/typst-compiler.worker.ts", import.meta.url),
    { type: "module" }
  );

  workerInstance.onmessage = (e) => {
    const { id, ...data } = e.data;
    const handler = workerPending.get(id);
    if (handler) {
      workerPending.delete(id);
      if (data.type === "error") {
        handler.reject(new Error(data.error));
      } else {
        handler.resolve(data);
      }
    }
  };

  workerInstance.onerror = (e) => {
    console.error("Compiler worker error:", e);
  };

  return workerInstance;
}

function sendToWorker(msg: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = workerNextId++;
    workerPending.set(id, { resolve, reject });
    getWorker().postMessage({ id, ...msg });
  });
}

function resetWorker() {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
  for (const { reject } of workerPending.values()) {
    reject(new Error("Worker reset"));
  }
  workerPending.clear();
  workerNextId = 0;
}

// ---------------------------------------------------------------------------
// Fixed 150ms debounce — compilation is in a worker so it never blocks typing
// ---------------------------------------------------------------------------
const DEBOUNCE_MS = 150;

export function useTypstCompiler(
  projectId: string,
  activeFilePath: string | null,
  contentRef: { current: string | null },
  allFiles: FileEntry[],
  version: string,
  mainFilePath?: string,
) {
  const [error, setError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [diagnostics, setDiagnostics] = useState<CompilerDiagnostic[]>([]);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [artifactContent, setArtifactContent] = useState<Uint8Array | null>(null);
  const [rendererReady, setRendererReady] = useState<TypstRenderer | null>(null);
  const rendererSetRef = useRef(false);

  // Compile trigger — increment to request a new compilation
  const [compileSeq, setCompileSeq] = useState(0);

  const triggerCompile = useCallback(() => {
    setCompileSeq((s) => s + 1);
  }, []);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const needsMountRef = useRef(true);
  const needsResetRef = useRef(true);

  // contentRef is passed in from the parent — always has latest content
  // without triggering re-renders (updated by handleChange directly)

  const activeFilePathRef = useRef(activeFilePath);
  activeFilePathRef.current = activeFilePath;

  const versionRef = useRef(version);
  versionRef.current = version;

  const allFilesRef = useRef(allFiles);
  allFilesRef.current = allFiles;

  // Use the project's configured main file, or fall back to main.typ / first .typ
  const mainFile = useMemo(() => {
    if (mainFilePath) return mainFilePath;
    const main = allFiles.find((f) => f.path === "main.typ");
    if (main) return main.path;
    const first = allFiles.find((f) => f.path.endsWith(".typ"));
    return first?.path ?? "main.typ";
  }, [mainFilePath, allFiles]);

  const mainFileRef = useRef(mainFile);
  mainFileRef.current = mainFile;

  // Reset VFS mount flag when project files change
  useEffect(() => {
    needsMountRef.current = true;
  }, [allFiles]);

  // Recompile when version or mainFile changes; fully reset compiler + renderer
  useEffect(() => {
    resetWorker();
    rendererCache.clear();
    rendererSetRef.current = false;
    setRendererReady(null);
    needsMountRef.current = true;
    needsResetRef.current = true;
    setCompileSeq((s) => s + 1);
  }, [version, mainFile]);

  // Compile mutex: prevents overlapping compile+render cycles
  const compileGuardRef = useRef({ busy: false, pending: false });

  // Compile via worker — ONLY triggered by compileSeq changes
  useEffect(() => {
    if (compileSeq === 0) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(async () => {
      // If a compile is already running, mark pending and bail
      if (compileGuardRef.current.busy) {
        compileGuardRef.current.pending = true;
        return;
      }
      compileGuardRef.current.busy = true;
      // startTransition: makes "Compiling..." indicator non-urgent so React
      // won't block CodeMirror's DOM paint to show the button change.
      startTransition(() => setCompiling(true));

      try {
        const needsMount = needsMountRef.current;
        const needsReset = needsResetRef.current;

        // Send compile request to the Web Worker (runs off main thread)
        const result = await sendToWorker({
          type: "compile",
          version: versionRef.current,
          projectId,
          files: allFilesRef.current.map((f) => ({
            path: f.path,
            isDirectory: f.isDirectory,
          })),
          needsMount,
          activeFilePath: activeFilePathRef.current,
          activeFileContent: contentRef.current,
          needsReset: needsReset || needsMount,
          mainFilePath: mainFileRef.current,
          format: 0, // vector
        });

        // Update flags after successful worker round-trip —
        // the worker has mounted/reset regardless of whether we use the result
        if (needsMount) needsMountRef.current = false;
        if (needsReset) needsResetRef.current = false;

        // If the user typed more while the worker was compiling, this result
        // is already stale. Skip the expensive main-thread work (page info
        // WASM + React state updates that trigger PreviewPanel canvas rendering)
        // and let the next compile produce a fresh result.
        if (compileGuardRef.current.pending) return;

        if (result.success && result.result) {
          // --- Phase 1: async work (no state updates yet) ---
          // Get renderer (cached after first call, ~0ms; first call loads WASM)
          const renderer = await getRenderer(versionRef.current);

          // Get page info (~7ms WASM, no DOM)
          let newPages: PageInfo[] | null = null;
          await renderer.runWithSession(
            {
              format: "vector" as any,
              artifactContent: result.result,
            },
            async (session) => {
              newPages = session.retrievePagesInfo();
            }
          );

          // Check again after async work — user may have typed more
          if (compileGuardRef.current.pending) return;

          // --- Phase 2: low-priority transition for preview state ---
          // startTransition tells React these updates are non-urgent.
          // If a keystroke (urgent) arrives mid-render, React pauses this
          // transition, processes the keystroke immediately, then resumes.
          // Combined with React.memo on EditorPanel, typing is completely
          // decoupled from preview rendering.
          startTransition(() => {
            setArtifactContent(result.result);
            if (!rendererSetRef.current) {
              setRendererReady(renderer);
              rendererSetRef.current = true;
            }
            if (newPages) {
              setPages((prev) => {
                if (
                  prev.length === newPages!.length &&
                  prev.every(
                    (p, i) =>
                      p.width === newPages![i].width &&
                      p.height === newPages![i].height
                  )
                ) {
                  return prev;
                }
                return newPages!;
              });
            }
            setError(null);
          });
        } else {
          // Compilation failed — show diagnostics
          const diags = result.diagnostics ?? [];
          if (diags.length > 0) {
            const newDiags: CompilerDiagnostic[] = diags.map(
              (d: any) => ({
                severity:
                  d.severity === "error"
                    ? ("error" as const)
                    : ("warning" as const),
                message: `${d.path}:${d.range}: ${d.message}`,
                timestamp: Date.now(),
              })
            );
            setDiagnostics((prev) => [...prev.slice(-49), ...newDiags]);
          }

          const errMsg =
            diags
              .filter((d: any) => d.severity === "error")
              .map((d: any) => `${d.path}:${d.range}: ${d.message}`)
              .join("\n") || "Compilation failed";
          setError(errMsg);
        }
      } catch (e: any) {
        const message = e?.message || String(e);
        // Don't report "Worker reset" as an error — it's expected during version changes
        if (message !== "Worker reset") {
          setError(message);
          setDiagnostics((prev) => [
            ...prev.slice(-49),
            { severity: "error" as const, message, timestamp: Date.now() },
          ]);
        }
      } finally {
        startTransition(() => setCompiling(false));
        compileGuardRef.current.busy = false;

        // If another compile was requested while we were busy, trigger it
        if (compileGuardRef.current.pending) {
          compileGuardRef.current.pending = false;
          setCompileSeq((s) => s + 1);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compileSeq]);

  const clearDiagnostics = useCallback(() => setDiagnostics([]), []);

  return {
    error,
    compiling,
    diagnostics,
    clearDiagnostics,
    pages,
    artifactContent,
    renderer: rendererReady,
    triggerCompile,
  };
}

// ---------------------------------------------------------------------------
// PDF export — uses the same worker for compilation
// ---------------------------------------------------------------------------
export async function exportPdf(
  projectId: string,
  allFiles: FileEntry[],
  mainFile: string,
  filename: string,
  version: string
) {
  const result = await sendToWorker({
    type: "compile",
    version,
    projectId,
    files: allFiles.map((f) => ({
      path: f.path,
      isDirectory: f.isDirectory,
    })),
    needsMount: true,
    activeFilePath: null,
    activeFileContent: null,
    needsReset: true,
    mainFilePath: mainFile,
    format: 1, // PDF
  });

  if (!result.success || !result.result) {
    throw new Error("PDF compilation failed");
  }

  const blob = new Blob([result.result], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/\.typ$/, ".pdf");
  a.click();
  URL.revokeObjectURL(url);
}
