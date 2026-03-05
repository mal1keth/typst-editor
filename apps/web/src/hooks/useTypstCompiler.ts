import { useState, useEffect, useRef } from "react";

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

export function useTypstCompiler(content: string, version: string) {
  const [svgContent, setSvgContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(async () => {
      setCompiling(true);
      try {
        const compiler = await getTypst(version);
        const svg = await compiler.svg({ mainContent: contentRef.current });
        setSvgContent(svg);
        setError(null);
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setCompiling(false);
      }
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [content, version]);

  return { svgContent, error, compiling };
}

export async function exportPdf(
  content: string,
  filename: string,
  version: string
) {
  const compiler = await getTypst(version);
  const pdf = await compiler.pdf({ mainContent: content });
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/\.typ$/, ".pdf");
  a.click();
  URL.revokeObjectURL(url);
}
