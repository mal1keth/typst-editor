# Typst Editor

A collaborative web-based editor for [Typst](https://typst.app/) documents with real-time preview, multi-user editing, and GitHub integration.

## Features

- **Live Preview** — Typst documents compile in-browser using WASM, with instant preview as you type
- **Collaborative Editing** — Real-time multi-user editing powered by Yjs and WebSockets
- **GitHub Sync** — Import repositories and push/pull changes directly from the editor
- **Edit History** — Browse and diff previous versions of your documents
- **File Management** — Multi-file project support with a familiar file tree sidebar
- **Sharing** — Generate anonymous share links for quick collaboration

## Tech Stack

- **Frontend**: React, CodeMirror 6, Typst WASM compiler, Vite
- **Backend**: Node.js, Hono, SQLite (via Drizzle ORM), WebSockets
- **Deployment**: Docker, Railway

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm

### Development

```bash
pnpm install

# Start the dev server (frontend + backend)
pnpm --filter @typst-editor/server dev
pnpm --filter @typst-editor/web dev
```

### Docker

```bash
docker compose up --build
```

The app will be available at `http://localhost:3000`.

## Acknowledgements

This project was built with the help of AI-assisted coding tools.
