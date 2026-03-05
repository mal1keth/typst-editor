import * as Y from "yjs";
import { readProjectFile, writeProjectFile } from "../lib/storage.js";

interface DocState {
  doc: Y.Doc;
  conns: Set<WebSocket>;
  dirty: boolean;
  projectId: string;
  filePath: string;
  saveTimer: ReturnType<typeof setTimeout> | null;
  gcTimer: ReturnType<typeof setTimeout> | null;
}

const docs = new Map<string, DocState>();

function getDocKey(projectId: string, filePath: string): string {
  return `${projectId}:${filePath}`;
}

function getOrCreateDoc(projectId: string, filePath: string): DocState {
  const key = getDocKey(projectId, filePath);
  let state = docs.get(key);

  if (!state) {
    const doc = new Y.Doc();
    const ytext = doc.getText("content");

    // Load initial content from disk
    const content = readProjectFile(projectId, filePath);
    if (content) {
      ytext.insert(0, content);
    }

    state = {
      doc,
      conns: new Set(),
      dirty: false,
      projectId,
      filePath,
      saveTimer: null,
      gcTimer: null,
    };

    // Track changes
    doc.on("update", () => {
      state!.dirty = true;
      scheduleSave(state!);
    });

    docs.set(key, state);
  }

  // Clear GC timer if a new connection is coming
  if (state.gcTimer) {
    clearTimeout(state.gcTimer);
    state.gcTimer = null;
  }

  return state;
}

function scheduleSave(state: DocState) {
  if (state.saveTimer) return;
  state.saveTimer = setTimeout(() => {
    persistDoc(state);
    state.saveTimer = null;
  }, 5000);
}

function persistDoc(state: DocState) {
  if (!state.dirty) return;
  const ytext = state.doc.getText("content");
  const content = ytext.toString();
  writeProjectFile(state.projectId, state.filePath, content);
  state.dirty = false;
}

function scheduleGC(state: DocState) {
  state.gcTimer = setTimeout(() => {
    // Persist final state
    persistDoc(state);
    if (state.saveTimer) clearTimeout(state.saveTimer);

    // Remove from memory
    state.doc.destroy();
    const key = getDocKey(state.projectId, state.filePath);
    docs.delete(key);
  }, 60000); // 60s after last disconnect
}

export function handleYjsConnection(
  ws: WebSocket,
  projectId: string,
  filePath: string,
  permission: string
) {
  const state = getOrCreateDoc(projectId, filePath);
  state.conns.add(ws);

  const doc = state.doc;

  // Send initial sync
  const encoder = Y.encodeStateAsUpdate(doc);
  ws.send(
    JSON.stringify({
      type: "sync",
      data: Array.from(encoder),
    })
  );

  // Send awareness of existing peers
  const peerCount = state.conns.size;
  broadcastToAll(state, {
    type: "peers",
    count: peerCount,
  });

  ws.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(String(event.data));

      if (msg.type === "update") {
        // Reject updates from read-only users
        if (permission === "read") return;

        const update = new Uint8Array(msg.data);
        Y.applyUpdate(doc, update);

        // Broadcast to other clients
        for (const conn of state.conns) {
          if (conn !== ws && conn.readyState === 1) {
            conn.send(
              JSON.stringify({
                type: "update",
                data: Array.from(update),
              })
            );
          }
        }
      } else if (msg.type === "awareness") {
        // Broadcast awareness to all other clients
        for (const conn of state.conns) {
          if (conn !== ws && conn.readyState === 1) {
            conn.send(JSON.stringify(msg));
          }
        }
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.addEventListener("close", () => {
    state.conns.delete(ws);

    // Notify remaining peers
    broadcastToAll(state, {
      type: "peers",
      count: state.conns.size,
    });

    // Schedule GC if no more connections
    if (state.conns.size === 0) {
      scheduleGC(state);
    }
  });
}

function broadcastToAll(state: DocState, msg: any) {
  const data = JSON.stringify(msg);
  for (const conn of state.conns) {
    if (conn.readyState === 1) {
      conn.send(data);
    }
  }
}
