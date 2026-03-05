import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  createTypstCompiler,
  createTypstRenderer,
  MemoryAccessModel,
  FetchPackageRegistry,
  initOptions,
  type TypstCompiler,
  type TypstRenderer,
  type RenderSession,
} from "@myriaddreamin/typst.ts";
import type { PageInfo } from "@myriaddreamin/typst.ts/dist/esm/internal.types.mjs";
import type { FileEntry } from "@/lib/api";

// Supported compiler versions
export const TYPST_VERSIONS = [
  { pkg: "0.7.0-rc2", label: "0.14 (latest)" },
  { pkg: "0.6.0", label: "0.13" },
  { pkg: "0.5.4", label: "0.12" },
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

interface CompilerInstance {
  compiler: TypstCompiler;
  renderer: TypstRenderer;
}

// Cache compiler+renderer instances by version
const instanceCache = new Map<string, Promise<CompilerInstance>>();

async function getCompilerInstance(version: string): Promise<CompilerInstance> {
  const cached = instanceCache.get(version);
  if (cached) return cached;

  const promise = (async () => {
    const accessModel = new MemoryAccessModel();
    const packageRegistry = new FetchPackageRegistry(accessModel);

    const compiler = createTypstCompiler();
    await compiler.init({
      getModule: () => wasmUrl(version, "typst-ts-web-compiler"),
      beforeBuild: [
        initOptions.withAccessModel(accessModel),
        initOptions.withPackageRegistry(packageRegistry),
      ],
    });

    const renderer = createTypstRenderer();
    await renderer.init({
      getModule: () => wasmUrl(version, "typst-ts-renderer"),
    });

    return { compiler, renderer };
  })();

  instanceCache.set(version, promise);
  return promise;
}

// Fetch file content from the API
async function fetchFileContent(
  projectId: string,
  path: string
): Promise<string | null> {
  try {
    const res = await fetch(`/api/projects/${projectId}/files/${encodeURIComponent(path)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.content ?? null;
  } catch {
    return null;
  }
}

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg",
  ".pdf", ".ttf", ".otf", ".woff", ".woff2",
]);

function isBinaryFile(path: string): boolean {
  const ext = path.substring(path.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

// Fetch binary file content
async function fetchBinaryContent(
  projectId: string,
  path: string
): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`/api/projects/${projectId}/files/${encodeURIComponent(path)}`);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

// Adaptive debounce based on file size and last compile time
function getDebounceMs(contentLength: number, lastCompileMs: number): number {
  let base: number;
  if (contentLength < 1000) base = 150;
  else if (contentLength < 10000) base = 300;
  else base = 500;

  if (lastCompileMs > 500) {
    return Math.max(base, Math.min(lastCompileMs * 1.5, 2000));
  }
  return base;
}

export interface CompilerState {
  error: string | null;
  compiling: boolean;
  diagnostics: CompilerDiagnostic[];
  pages: PageInfo[];
}

export function useTypstCompiler(
  projectId: string,
  activeFilePath: string | null,
  activeFileContent: string | null,
  allFiles: FileEntry[],
  version: string,
  containerRef: React.RefObject<HTMLDivElement | null>,
  mainFilePath?: string,
) {
  const [error, setError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [diagnostics, setDiagnostics] = useState<CompilerDiagnostic[]>([]);
  const [pages, setPages] = useState<PageInfo[]>([]);

  // Compile trigger — increment to request a new compilation
  const [compileSeq, setCompileSeq] = useState(0);

  const triggerCompile = useCallback(() => {
    setCompileSeq((s) => s + 1);
  }, []);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCompileMsRef = useRef(300);
  const instanceRef = useRef<CompilerInstance | null>(null);
  const vfsMountedRef = useRef(false);
  const mountedFilesRef = useRef(new Set<string>());
  const mainFilePathRef = useRef<string | null>(null);

  // Use refs so the compile effect only triggers from compileSeq
  const contentRef = useRef(activeFileContent);
  contentRef.current = activeFileContent;

  const activeFilePathRef = useRef(activeFilePath);
  activeFilePathRef.current = activeFilePath;

  const versionRef = useRef(version);
  versionRef.current = version;

  // Use the project's configured main file, or fall back to main.typ / first .typ
  const mainFile = useMemo(() => {
    if (mainFilePath) return mainFilePath;
    const main = allFiles.find((f) => f.path === "main.typ");
    if (main) return main.path;
    const first = allFiles.find((f) => f.path.endsWith(".typ"));
    return first?.path ?? "main.typ";
  }, [mainFilePath, allFiles]);

  // Mount all project files into the compiler VFS
  const mountAllFiles = useCallback(
    async (compiler: TypstCompiler) => {
      if (vfsMountedRef.current) return;

      const newMounted = new Set<string>();

      for (const file of allFiles) {
        if (file.isDirectory) continue;

        const filePath = "/" + file.path;

        if (isBinaryFile(file.path)) {
          const content = await fetchBinaryContent(projectId, file.path);
          if (content) {
            compiler.mapShadow(filePath, content);
            newMounted.add(file.path);
          }
        } else {
          const content = await fetchFileContent(projectId, file.path);
          if (content !== null) {
            compiler.addSource(filePath, content);
            newMounted.add(file.path);
          }
        }
      }

      mountedFilesRef.current = newMounted;
      vfsMountedRef.current = true;
    },
    [projectId, allFiles]
  );

  // Keep refs for values used inside the compile effect (so deps stay minimal)
  const mountAllFilesRef = useRef(mountAllFiles);
  mountAllFilesRef.current = mountAllFiles;
  const mainFileRef = useRef(mainFile);
  mainFileRef.current = mainFile;

  // Reset VFS when project files change
  useEffect(() => {
    vfsMountedRef.current = false;
  }, [allFiles]);

  // Recompile when version or mainFile changes; fully reset compiler state
  useEffect(() => {
    // Clear cached instances to avoid stale comemo caches (e.g. false cyclic imports)
    instanceCache.clear();
    instanceRef.current = null;
    vfsMountedRef.current = false;
    setCompileSeq((s) => s + 1);
  }, [version, mainFile]);

  // Compile mutex: prevents overlapping compile+render cycles
  const compileGuardRef = useRef({ busy: false, pending: false });

  // Compile and render — ONLY triggered by compileSeq changes
  useEffect(() => {
    if (compileSeq === 0) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    const content = contentRef.current;
    const debounceMs = getDebounceMs(
      content?.length ?? 0,
      lastCompileMsRef.current
    );

    timerRef.current = setTimeout(async () => {
      // If a compile is already running, mark pending and bail
      if (compileGuardRef.current.busy) {
        compileGuardRef.current.pending = true;
        return;
      }
      compileGuardRef.current.busy = true;
      setCompiling(true);
      const startTime = performance.now();

      try {
        // Get or create compiler instance
        if (!instanceRef.current) {
          instanceRef.current = await getCompilerInstance(versionRef.current);
        }

        const { compiler, renderer } = instanceRef.current;

        // Mount all files on first compile
        await mountAllFilesRef.current(compiler);

        // Update only the changed file (preserves comemo caches for all other files)
        const currentPath = activeFilePathRef.current;
        const currentContent = contentRef.current;
        if (currentPath && currentContent !== null) {
          compiler.addSource("/" + currentPath, currentContent);
        }

        // Compile to vector format
        const compileResult = await compiler.compile({
          mainFilePath: "/" + mainFileRef.current,
          format: 0, // CompileFormatEnum.vector
          diagnostics: "full",
        });

        // Handle diagnostics
        if (compileResult.diagnostics && compileResult.diagnostics.length > 0) {
          const newDiags: CompilerDiagnostic[] = compileResult.diagnostics.map(
            (d: any) => ({
              severity: d.severity === "error" ? "error" as const : "warning" as const,
              message: `${d.path}:${d.range}: ${d.message}`,
              timestamp: Date.now(),
            })
          );
          setDiagnostics((prev) => [...prev.slice(-49), ...newDiags]);
        }

        if (!compileResult.result) {
          const errMsg =
            compileResult.diagnostics
              ?.filter((d: any) => d.severity === "error")
              .map((d: any) => `${d.path}:${d.range}: ${d.message}`)
              .join("\n") || "Compilation failed";
          setError(errMsg);
          return;
        }

        // Render: clear container, then render new content
        const container = containerRef.current;
        if (container) {
          container.innerHTML = "";

          await renderer.renderToCanvas({
            container,
            format: "vector" as any,
            artifactContent: compileResult.result,
            backgroundColor: "#ffffff",
            pixelPerPt: 2,
          } as any);

          // Get page info for zoom controls
          await renderer.runWithSession(
            {
              format: "vector" as any,
              artifactContent: compileResult.result,
            },
            async (session) => {
              setPages(session.retrievePagesInfo());
            }
          );
        }

        setError(null);
      } catch (e: any) {
        const message = e?.message || String(e);
        setError(message);
        setDiagnostics((prev) => [
          ...prev.slice(-49),
          { severity: "error" as const, message, timestamp: Date.now() },
        ]);
      } finally {
        lastCompileMsRef.current = performance.now() - startTime;
        setCompiling(false);
        compileGuardRef.current.busy = false;

        // If another compile was requested while we were busy, trigger it
        if (compileGuardRef.current.pending) {
          compileGuardRef.current.pending = false;
          setCompileSeq((s) => s + 1);
        }
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compileSeq]);

  const clearDiagnostics = useCallback(() => setDiagnostics([]), []);

  return { error, compiling, diagnostics, clearDiagnostics, pages, triggerCompile };
}

export async function exportPdf(
  projectId: string,
  allFiles: FileEntry[],
  mainFile: string,
  filename: string,
  version: string
) {
  const { compiler } = await getCompilerInstance(version);

  // Mount all files
  for (const file of allFiles) {
    if (file.isDirectory) continue;
    if (isBinaryFile(file.path)) {
      const content = await fetchBinaryContent(projectId, file.path);
      if (content) compiler.mapShadow("/" + file.path, content);
    } else {
      const content = await fetchFileContent(projectId, file.path);
      if (content !== null) compiler.addSource("/" + file.path, content);
    }
  }

  const result = await compiler.compile({
    mainFilePath: "/" + mainFile,
    format: 1, // CompileFormatEnum.pdf
    diagnostics: "full",
  });

  if (!result.result) {
    throw new Error("PDF compilation failed");
  }

  const blob = new Blob([new Uint8Array(result.result)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/\.typ$/, ".pdf");
  a.click();
  URL.revokeObjectURL(url);
}
