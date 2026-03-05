import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { LoginPage } from "@/components/Auth/LoginPage";
import { ProjectList } from "@/components/Layout/ProjectList";
import { EditorLayout } from "@/components/Layout/EditorLayout";
import { api } from "@/lib/api";

export default function App() {
  const { user, loading, checkAuth } = useAuthStore();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
    // Restore project from URL hash (e.g. #project=abc123)
    const match = window.location.hash.match(/^#project=(.+)$/);
    return match ? match[1] : null;
  });

  // Anonymous share link state
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [sharedProjectId, setSharedProjectId] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  // Sync active project to URL hash
  useEffect(() => {
    if (activeProjectId) {
      window.location.hash = `project=${activeProjectId}`;
    } else {
      if (window.location.hash.startsWith("#project=")) {
        window.location.hash = "";
      }
    }
  }, [activeProjectId]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Handle share links: /s/:token
  useEffect(() => {
    const path = window.location.pathname;
    if (!path.startsWith("/s/")) return;

    const token = path.slice(3);

    if (user) {
      // Logged-in user — join as collaborator
      api.shares.join(token).then((result) => {
        setActiveProjectId(result.projectId);
        window.history.replaceState(null, "", "/");
      }).catch(() => {
        window.history.replaceState(null, "", "/");
      });
    } else if (!loading) {
      // Anonymous user — resolve token for read-only access
      api.shares.resolve(token).then((result) => {
        setShareToken(token);
        setSharedProjectId(result.projectId);
      }).catch(() => {
        setShareError("Invalid or expired share link");
      });
    }
  }, [user, loading]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-gray-400">
        Loading...
      </div>
    );
  }

  // Anonymous shared project view
  if (shareToken && sharedProjectId) {
    return (
      <EditorLayout
        projectId={sharedProjectId}
        shareToken={shareToken}
        onBack={() => {
          setShareToken(null);
          setSharedProjectId(null);
          window.history.replaceState(null, "", "/");
        }}
      />
    );
  }

  // Invalid share link error
  if (shareError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-gray-950 text-gray-400">
        <p>{shareError}</p>
        <button
          onClick={() => {
            setShareError(null);
            window.history.replaceState(null, "", "/");
          }}
          className="rounded bg-gray-800 px-4 py-2 text-sm hover:bg-gray-700"
        >
          Go to login
        </button>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (activeProjectId) {
    return (
      <EditorLayout
        projectId={activeProjectId}
        onBack={() => setActiveProjectId(null)}
      />
    );
  }

  return <ProjectList onOpenProject={setActiveProjectId} />;
}
