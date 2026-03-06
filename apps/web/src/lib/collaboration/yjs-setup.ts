import * as Y from "yjs";
import type { ChangeSet } from "@codemirror/state";

export interface PresenceUser {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface CollabState {
  doc: Y.Doc;
  ytext: Y.Text;
  ws: WebSocket | null;
  connected: boolean;
  peerCount: number;
  destroy: () => void;
}

export function setupCollaboration(
  projectId: string,
  filePath: string,
  initialContent: string,
  onRemoteUpdate: (content: string) => void,
  onConnectionChange: (connected: boolean, peerCount: number) => void,
  onPresenceChange?: (users: PresenceUser[]) => void,
): CollabState {
  const doc = new Y.Doc();
  const ytext = doc.getText("content");

  const state: CollabState = {
    doc,
    ytext,
    ws: null,
    connected: false,
    peerCount: 0,
    destroy: () => {
      if (state.ws) {
        state.ws.close();
        state.ws = null;
      }
      doc.destroy();
    },
  };

  // No token needed in URL — the httpOnly auth cookie is automatically
  // sent with the WebSocket upgrade request by the browser.
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProtocol}//${window.location.host}/ws/yjs/${projectId}/${encodeURIComponent(filePath)}`;

  function connect() {
    const ws = new WebSocket(wsUrl);
    state.ws = ws;

    ws.onopen = () => {
      state.connected = true;
      onConnectionChange(true, state.peerCount);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "sync") {
          const update = new Uint8Array(msg.data);
          Y.applyUpdate(doc, update);
          onRemoteUpdate(ytext.toString());
        } else if (msg.type === "update") {
          const update = new Uint8Array(msg.data);
          Y.applyUpdate(doc, update);
          onRemoteUpdate(ytext.toString());
        } else if (msg.type === "presence") {
          // Project-level presence: array of connected users
          const users: PresenceUser[] = msg.users ?? [];
          state.peerCount = users.length;
          onConnectionChange(state.connected, users.length);
          onPresenceChange?.(users);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      state.connected = false;
      state.ws = null;
      onConnectionChange(false, 0);
      onPresenceChange?.([]);

      // Reconnect after 2s
      setTimeout(() => {
        if (!state.ws) connect();
      }, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  // Initialize with content if ytext is empty
  if (ytext.length === 0 && initialContent) {
    ytext.insert(0, initialContent);
  }

  connect();

  return state;
}

// Debounced send: batch rapid keystrokes into one WebSocket message
let collabSendTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Apply local changes using CodeMirror's ChangeSet for minimal CRDT diffs.
 * Instead of delete-all/insert-all, we apply only the changed ranges.
 * The state encoding + WebSocket send is debounced (50ms) so rapid
 * keystrokes are batched into a single update.
 */
export function applyLocalChange(
  state: CollabState,
  changes: ChangeSet
) {
  const { doc, ytext, ws } = state;

  doc.transact(() => {
    let offset = 0;
    changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const deleteLen = toA - fromA;
      const adjustedPos = fromA + offset;

      if (deleteLen > 0) {
        ytext.delete(adjustedPos, deleteLen);
      }
      const insertText = inserted.toString();
      if (insertText.length > 0) {
        ytext.insert(adjustedPos, insertText);
      }

      offset += insertText.length - deleteLen;
    });
  });

  // Debounce: batch multiple keystrokes into one WebSocket send
  if (collabSendTimer) clearTimeout(collabSendTimer);
  collabSendTimer = setTimeout(() => {
    collabSendTimer = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const update = Y.encodeStateAsUpdate(doc);
      ws.send(
        JSON.stringify({
          type: "update",
          data: Array.from(update),
        })
      );
    }
  }, 50);
}
