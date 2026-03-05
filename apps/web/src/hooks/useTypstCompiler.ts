import { useState, useEffect, useRef, useCallback } from "react";

// Each version loads its entire stack (JS wrapper + WASM) from CDN
// so the JS glue code always matches its WASM binary.
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

// Cache loaded compilers by version
const compilerCache = new Map<string, any>();

function wasmUrl(pkg: string, name: string) {
  return `https://cdn.jsdelivr.net/npm/@myriaddreamin/${name}@${pkg}/pkg/${name.replace(/-/g, "_")}_bg.wasm`;
}

async function getTypst(version: string) {
  const cached = compilerCache.get(version);
  if (cached) return cached;

  // Load the JS wrapper from esm.sh which resolves bare module specifiers
  const snippetUrl = `https://esm.sh/@myriaddreamin/typst.ts@${version}/dist/esm/contrib/snippet.mjs`;
  const mod = await import(/* @vite-ignore */ snippetUrl);
  const $typst = mod.$typst;

  $typst.setCompilerInitOptions({
    getModule: () => wasmUrl(version, "typst-ts-web-compiler"),
  });
  $typst.setRendererInitOptions({
    getModule: () => wasmUrl(version, "typst-ts-renderer"),
  });

  compilerCache.set(version, $typst);
  return $typst;
}

export interface CompilerDiagnostic {
  severity: "error" | "warning";
  message: string;
  timestamp: number;
}

export interface ProjectFile {
  path: string;
  content: string;
  binary: boolean;
}

export function useTypstCompiler(
  content: string,
  version: string,
  mainFilePath?: string,
  projectFiles?: ProjectFile[]
) {
  const [svgContent, setSvgContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [diagnostics, setDiagnostics] = useState<CompilerDiagnostic[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  const projectFilesRef = useRef(projectFiles);
  contentRef.current = content;
  projectFilesRef.current = projectFiles;

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(async () => {
      setCompiling(true);
      try {
        const compiler = await getTypst(version);

        // Mount all project files into the virtual filesystem
        const files = projectFilesRef.current;
        if (files && files.length > 0) {
          // Reset shadow filesystem to avoid stale files
          if (compiler.resetShadow) await compiler.resetShadow();

          for (const file of files) {
            const vfsPath = `/${file.path}`;
            if (file.binary) {
              // Decode base64 to Uint8Array
              const raw = atob(file.content);
              const bytes = new Uint8Array(raw.length);
              for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
              await compiler.mapShadow(vfsPath, bytes);
            } else {
              await compiler.addSource(vfsPath, file.content);
            }
          }

          // Overwrite the main file with current editor content
          const mainPath = mainFilePath ? `/${mainFilePath}` : "/main.typ";
          await compiler.addSource(mainPath, contentRef.current);

          const svg = await compiler.svg({ mainFilePath: mainPath });
          setSvgContent(svg);
        } else {
          // No project files — simple single-file mode
          const svg = await compiler.svg({ mainContent: contentRef.current });
          setSvgContent(svg);
        }

        setError(null);
        setDiagnostics([]);
      } catch (e: any) {
        const message = e?.message || String(e);
        setError(message);
        // Don't clear svgContent — it retains the last successful render
        setDiagnostics((prev) => [
          ...prev.slice(-49),
          { severity: "error" as const, message, timestamp: Date.now() },
        ]);
      } finally {
        setCompiling(false);
      }
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [content, version, mainFilePath]);

  const clearDiagnostics = useCallback(() => setDiagnostics([]), []);

  return { svgContent, error, compiling, diagnostics, clearDiagnostics };
}

export async function exportPdf(
  content: string,
  filename: string,
  version: string,
  mainFilePath?: string,
  projectFiles?: ProjectFile[]
) {
  const compiler = await getTypst(version);

  let pdf: Uint8Array;
  if (projectFiles && projectFiles.length > 0) {
    if (compiler.resetShadow) await compiler.resetShadow();
    for (const file of projectFiles) {
      const vfsPath = `/${file.path}`;
      if (file.binary) {
        const raw = atob(file.content);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        await compiler.mapShadow(vfsPath, bytes);
      } else {
        await compiler.addSource(vfsPath, file.content);
      }
    }
    const mainPath = mainFilePath ? `/${mainFilePath}` : "/main.typ";
    await compiler.addSource(mainPath, content);
    pdf = await compiler.pdf({ mainFilePath: mainPath });
  } else {
    pdf = await compiler.pdf({ mainContent: content });
  }

  const blob = new Blob([pdf as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/\.typ$/, ".pdf");
  a.click();
  URL.revokeObjectURL(url);
}
