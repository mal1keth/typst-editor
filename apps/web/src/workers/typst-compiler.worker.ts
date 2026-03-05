/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import {
  createTypstCompiler,
  MemoryAccessModel,
  FetchPackageRegistry,
  initOptions,
  type TypstCompiler,
} from "@myriaddreamin/typst.ts";

let compiler: TypstCompiler | null = null;
let currentVersion: string | null = null;
let mounted = false;

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg",
  ".pdf", ".ttf", ".otf", ".woff", ".woff2",
]);

function isBinaryFile(path: string): boolean {
  const ext = path.substring(path.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function encodeFilePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function wasmUrl(pkg: string, name: string) {
  return `https://cdn.jsdelivr.net/npm/@myriaddreamin/${name}@${pkg}/pkg/${name.replace(/-/g, "_")}_bg.wasm`;
}

async function ensureCompiler(version: string): Promise<TypstCompiler> {
  if (compiler && currentVersion === version) return compiler;

  // Version changed or first init — create fresh
  compiler = null;
  mounted = false;
  currentVersion = version;

  const accessModel = new MemoryAccessModel();
  const packageRegistry = new FetchPackageRegistry(accessModel);

  const c = createTypstCompiler();
  await c.init({
    getModule: () => wasmUrl(version, "typst-ts-web-compiler"),
    beforeBuild: [
      initOptions.withAccessModel(accessModel),
      initOptions.withPackageRegistry(packageRegistry),
    ],
  });

  compiler = c;
  return c;
}

async function doMount(
  c: TypstCompiler,
  projectId: string,
  files: { path: string; isDirectory: boolean }[]
): Promise<boolean> {
  if (mounted) return false;

  for (const file of files) {
    if (file.isDirectory) continue;
    const filePath = "/" + file.path;

    if (isBinaryFile(file.path)) {
      try {
        const res = await fetch(`/api/projects/${projectId}/files/${encodeFilePath(file.path)}`);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          c.mapShadow(filePath, new Uint8Array(buf));
        }
      } catch { /* skip unavailable files */ }
    } else {
      try {
        const res = await fetch(`/api/projects/${projectId}/files/${encodeFilePath(file.path)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.content != null) {
            c.addSource(filePath, data.content);
          }
        }
      } catch { /* skip unavailable files */ }
    }
  }

  mounted = true;
  return true; // signals "just mounted"
}

// Message handler — processes compile requests sequentially
self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  try {
    if (msg.type === "compile") {
      const c = await ensureCompiler(msg.version);

      // Mount files if requested (first compile, or files changed)
      if (msg.needsMount) {
        mounted = false;
      }
      const justMounted = await doMount(c, msg.projectId, msg.files);

      // Reset after mount to clear accumulated addSource tracking state.
      // This prevents false "duplicate label" errors from typst.ts 0.7.0-rc2.
      if (msg.needsReset || justMounted) {
        await c.reset();
      }

      // Update active file with latest editor content.
      // Skip if just mounted — the file is already in the VFS from the mount,
      // and double-calling addSource() for the same path triggers a WASM bug in
      // typst.ts 0.7.0-rc2 where labels get registered twice.
      if (!justMounted && msg.activeFilePath && msg.activeFileContent !== null) {
        c.addSource("/" + msg.activeFilePath, msg.activeFileContent);
      }

      // Compile
      const format = msg.format ?? 0;
      const compileResult = await c.compile({
        mainFilePath: "/" + msg.mainFilePath,
        root: "/",
        format,
        diagnostics: "none",
      });

      if (compileResult.result) {
        // Copy result to a transferable buffer (original may be a WASM memory view)
        const result = new Uint8Array(compileResult.result);
        self.postMessage(
          { id: msg.id, type: "compiled", success: true, result, diagnostics: [] },
          [result.buffer]
        );
      } else if (format === 0) {
        // Vector compile failed — run diagnostic compile for error details
        const diagResult = await c.compile({
          mainFilePath: "/" + msg.mainFilePath,
          root: "/",
          format: 0,
          diagnostics: "full",
        });
        const diags = diagResult.diagnostics ?? compileResult.diagnostics ?? [];
        self.postMessage({
          id: msg.id, type: "compiled", success: false, result: null, diagnostics: diags,
        });
      } else {
        // PDF compile failed
        self.postMessage({
          id: msg.id, type: "compiled", success: false, result: null,
          diagnostics: compileResult.diagnostics ?? [],
        });
      }

    } else if (msg.type === "reset") {
      // Full reset — discard compiler instance
      compiler = null;
      currentVersion = null;
      mounted = false;
      self.postMessage({ id: msg.id, type: "reset" });
    }
  } catch (err: any) {
    self.postMessage({ id: msg.id, type: "error", error: err?.message || String(err) });
  }
};
