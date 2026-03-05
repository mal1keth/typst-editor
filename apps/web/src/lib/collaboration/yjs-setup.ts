import * as Y from "yjs";

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
  token: string,
  onRemoteUpdate: (content: string) => void,
  onConnectionChange: (connected: boolean, peerCount: number) => void
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

  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProtocol}//${window.location.host}/ws/yjs/${projectId}/${encodeURIComponent(filePath)}?token=${token}`;

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
        } else if (msg.type === "peers") {
          state.peerCount = msg.count;
          onConnectionChange(state.connected, msg.count);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      state.connected = false;
      state.ws = null;
      onConnectionChange(false, 0);

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

export function applyLocalChange(
  state: CollabState,
  newContent: string
) {
  const { doc, ytext, ws } = state;

  // Capture the update
  doc.transact(() => {
    ytext.delete(0, ytext.length);
    ytext.insert(0, newContent);
  });

  // Send update to server
  if (ws && ws.readyState === WebSocket.OPEN) {
    const update = Y.encodeStateAsUpdate(doc);
    ws.send(
      JSON.stringify({
        type: "update",
        data: Array.from(update),
      })
    );
  }
}
