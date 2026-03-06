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

/** Decode a base64 string to Uint8Array using fetch (much faster than atob loop). */
async function base64ToBytes(b64: string): Promise<Uint8Array> {
  const res = await fetch(`data:application/octet-stream;base64,${b64}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function doMount(
  c: TypstCompiler,
  projectId: string,
  shareToken?: string,
): Promise<boolean> {
  if (mounted) return false;

  // Fetch all file contents in a single request with retry for transient failures.
  const url = shareToken
    ? `/api/shared/${shareToken}/files-all`
    : `/api/projects/${projectId}/files-all`;

  let data: { files: Array<{ path: string; content: string; binary: boolean }> } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        console.error(`files-all fetch failed (attempt ${attempt + 1}): ${res.status}`);
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        break;
      }
      data = await res.json();
      break;
    } catch (e) {
      console.error(`Failed to fetch project files (attempt ${attempt + 1}):`, e);
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  if (data) {
    // Deduplicate paths — last occurrence wins (guards against server dupes)
    const seen = new Set<string>();
    const deduped = [];
    for (let i = data.files.length - 1; i >= 0; i--) {
      const vfsPath = "/" + data.files[i].path;
      if (!seen.has(vfsPath)) {
        seen.add(vfsPath);
        deduped.push(data.files[i]);
      }
    }

    for (const file of deduped) {
      const vfsPath = "/" + file.path;
      if (file.binary) {
        const bytes = await base64ToBytes(file.content);
        c.mapShadow(vfsPath, bytes);
      } else {
        c.addSource(vfsPath, file.content);
      }
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
      const justMounted = await doMount(c, msg.projectId, msg.shareToken);

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

      // Compile — single pass with diagnostics:"full" to avoid the
      // label-leak-across-reset WASM bug that the two-compile pattern triggers.
      const format = msg.format ?? 0;

      // PDF export: always reset before compiling to avoid false "duplicate label"
      // errors from typst.ts 0.7.0-rc2's addSource state accumulation.
      if (format === 1) {
        await c.reset();
      }

      const compileResult = await c.compile({
        mainFilePath: "/" + msg.mainFilePath,
        root: "/",
        format,
        diagnostics: "full",
      });

      if (compileResult.result) {
        const result = new Uint8Array(compileResult.result);
        self.postMessage(
          { id: msg.id, type: "compiled", success: true, result, diagnostics: compileResult.diagnostics ?? [] },
          [result.buffer]
        );
      } else {
        self.postMessage({
          id: msg.id, type: "compiled", success: false, result: null, diagnostics: compileResult.diagnostics ?? [],
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
    // WASM exceptions may contain raw Rust Debug output like:
    // [SourceDiagnostic { severity: Error, ... message: "...", ... }]
    // Extract human-readable messages from that format.
    let errorMsg = err?.message || String(err);
    const rawMessages = [...errorMsg.matchAll(/message:\s*"([^"]+)"/g)].map(m => m[1]);
    if (rawMessages.length > 0) {
      errorMsg = rawMessages.join("\n");
    }
    self.postMessage({ id: msg.id, type: "error", error: errorMsg });
  }
};
