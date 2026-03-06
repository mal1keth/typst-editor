import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  createTypstRenderer,
  type TypstRenderer,
} from "@myriaddreamin/typst.ts";
import type { PageInfo } from "@myriaddreamin/typst.ts/dist/esm/internal.types.mjs";
import type { FileEntry } from "@/lib/api";

// Version must match installed @myriaddreamin/typst-ts-* npm packages.
// JS bindings are version-specific — WASM from other versions won't load.
export const TYPST_VERSION = { pkg: "0.7.0-rc2", label: "0.14" } as const;

export interface CompilerDiagnostic {
  severity: "error" | "warning";
  message: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Renderer cache — stays on main thread for canvas rendering
// ---------------------------------------------------------------------------
function wasmUrl(pkg: string, name: string) {
  return `https://cdn.jsdelivr.net/npm/@myriaddreamin/${name}@${pkg}/pkg/${name.replace(/-/g, "_")}_bg.wasm`;
}

const rendererCache = new Map<string, Promise<TypstRenderer>>();

function getRenderer(version: string): Promise<TypstRenderer> {
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
const DEBOUNCE_MS = 250;

export function useTypstCompiler(
  projectId: string,
  activeFilePath: string | null,
  contentRef: { current: string | null },
  allFiles: FileEntry[],
  mainFilePath?: string,
  typingUntilRef?: { current: number },
  shareToken?: string,
) {
  const version = TYPST_VERSION.pkg;
  const [error, setError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [diagnostics, setDiagnostics] = useState<CompilerDiagnostic[]>([]);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [artifactContent, setArtifactContent] = useState<Uint8Array | null>(null);
  const [renderer, setRenderer] = useState<TypstRenderer | null>(null);

  // Compile trigger — increment to request a new compilation
  const [compileSeq, setCompileSeq] = useState(0);

  const triggerCompile = useCallback(() => {
    setCompileSeq((s) => s + 1);
  }, []);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const needsMountRef = useRef(true);
  const needsResetRef = useRef(true);

  const activeFilePathRef = useRef(activeFilePath);
  activeFilePathRef.current = activeFilePath;

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

  // Recompile when mainFile changes; fully reset compiler + renderer
  useEffect(() => {
    resetWorker();
    rendererCache.clear();
    setRenderer(null);
    needsMountRef.current = true;
    needsResetRef.current = true;
    setCompileSeq((s) => s + 1);
  }, [mainFile]);

  // Compile mutex: prevents overlapping compile cycles
  const compileGuardRef = useRef({ busy: false, pending: false });

  // Compile via worker — ONLY triggered by compileSeq changes
  useEffect(() => {
    if (compileSeq === 0) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(async () => {
      if (compileGuardRef.current.busy) {
        compileGuardRef.current.pending = true;
        return;
      }
      compileGuardRef.current.busy = true;
      setCompiling(true);

      try {
        const needsMount = needsMountRef.current;
        const needsReset = needsResetRef.current;

        const result = await sendToWorker({
          type: "compile",
          version: version,
          projectId,
          needsMount,
          activeFilePath: activeFilePathRef.current,
          activeFileContent: contentRef.current,
          needsReset: needsReset || needsMount,
          mainFilePath: mainFileRef.current,
          format: 0, // vector
          shareToken: shareToken || undefined,
        });

        if (needsMount) needsMountRef.current = false;
        if (needsReset) needsResetRef.current = false;

        // If the user typed more while compiling, this result is stale.
        // Skip the expensive main-thread WASM work (page info + render)
        // and let the next compile produce a fresh result.
        if (compileGuardRef.current.pending) return;

        // Wait for the user to stop typing before doing expensive main-thread
        // WASM work (page info extraction + canvas rendering via state update).
        // This keeps the event loop free while the user is actively typing.
        if (typingUntilRef) {
          while (Date.now() < typingUntilRef.current) {
            await new Promise(r => setTimeout(r, 50));
            // If a new compile was requested while waiting, bail
            if (compileGuardRef.current.pending) return;
          }
        }

        if (result.success && result.result) {
          const r = await getRenderer(version);

          let newPages: PageInfo[] | null = null;
          await r.runWithSession(
            { format: "vector" as any, artifactContent: result.result },
            async (session) => { newPages = session.retrievePagesInfo(); }
          );

          setArtifactContent(result.result);
          setRenderer(r);
          if (newPages) {
            setPages((prev) => {
              if (
                prev.length === newPages!.length &&
                prev.every((p, i) =>
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
        if (message !== "Worker reset") {
          setError(message);
          setDiagnostics((prev) => [
            ...prev.slice(-49),
            { severity: "error" as const, message, timestamp: Date.now() },
          ]);
        }
      } finally {
        setCompiling(false);
        compileGuardRef.current.busy = false;

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
    renderer,
    triggerCompile,
  };
}

// ---------------------------------------------------------------------------
// PDF export — reuses the worker's already-loaded VFS & compiler state.
// No remount or reset needed — just recompile with format: 1 (PDF).
// ---------------------------------------------------------------------------
export async function exportPdf(
  projectId: string,
  mainFile: string,
  filename: string,
  activeFilePath?: string | null,
  activeFileContent?: string | null,
) {
  const result = await sendToWorker({
    type: "compile",
    version: TYPST_VERSION.pkg,
    projectId,
    needsMount: false,
    activeFilePath: activeFilePath ?? null,
    activeFileContent: activeFileContent ?? null,
    needsReset: false,
    mainFilePath: mainFile,
    format: 1, // PDF
  });

  if (!result.success || !result.result) {
    const diags = result.diagnostics ?? [];
    const messages = diags
      .filter((d: any) => d.severity === "error")
      .map((d: any) => d.message || String(d))
      .slice(0, 5); // Show at most 5 errors
    const detail = messages.length > 0
      ? messages.join("\n")
      : "Compilation failed with errors";
    throw new Error(detail);
  }

  const blob = new Blob([result.result], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/\.typ$/, ".pdf");
  a.click();
  URL.revokeObjectURL(url);
}
