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
    if (path.startsWith("/s/") && user) {
      const token = path.slice(3);
      api.shares.join(token).then((result) => {
        setActiveProjectId(result.projectId);
        window.history.replaceState(null, "", "/");
      }).catch(() => {
        // Invalid token
        window.history.replaceState(null, "", "/");
      });
    }
  }, [user]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-gray-400">
        Loading...
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
