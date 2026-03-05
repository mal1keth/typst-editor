import { create } from "zustand";
import {
  api,
  type Project,
  type ProjectWithFiles,
  type FileEntry,
} from "@/lib/api";

interface ProjectState {
  // Project list
  ownedProjects: (Project & { role: string })[];
  collabProjects: (Project & { role: string })[];
  loadingList: boolean;

  // Current project
  currentProject: ProjectWithFiles | null;
  activeFilePath: string | null;
  activeFileContent: string | null;
  loadingProject: boolean;
  savingFile: boolean;

  // Actions
  loadProjects: () => Promise<void>;
  createProject: (name: string) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  saveFile: (path: string, content: string) => Promise<void>;
  createFile: (path: string, content?: string, isDirectory?: boolean) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  setActiveFileContent: (content: string) => void;
  updateMainFile: (mainFile: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  ownedProjects: [],
  collabProjects: [],
  loadingList: false,
  currentProject: null,
  activeFilePath: null,
  activeFileContent: null,
  loadingProject: false,
  savingFile: false,

  loadProjects: async () => {
    set({ loadingList: true });
    try {
      const data = await api.projects.list();
      set({
        ownedProjects: data.owned,
        collabProjects: data.collaborated,
        loadingList: false,
      });
    } catch {
      set({ loadingList: false });
    }
  },

  createProject: async (name: string) => {
    const project = await api.projects.create(name);
    await get().loadProjects();
    return project;
  },

  deleteProject: async (id: string) => {
    await api.projects.delete(id);
    await get().loadProjects();
  },

  loadProject: async (id: string) => {
    set({ loadingProject: true, currentProject: null, activeFilePath: null, activeFileContent: null });
    try {
      const project = await api.projects.get(id);
      set({ currentProject: project, loadingProject: false });

      // Auto-open the main file
      if (project.mainFile) {
        await get().openFile(project.mainFile);
      }
    } catch {
      set({ loadingProject: false });
    }
  },

  openFile: async (path: string) => {
    const { currentProject } = get();
    if (!currentProject) return;

    try {
      const data = await api.files.get(currentProject.id, path);
      set({ activeFilePath: path, activeFileContent: data.content });
    } catch {
      // File might not exist yet
      set({ activeFilePath: path, activeFileContent: "" });
    }
  },

  saveFile: async (path: string, content: string) => {
    const { currentProject } = get();
    if (!currentProject) return;

    set({ savingFile: true });
    try {
      await api.files.put(currentProject.id, path, content);
    } finally {
      set({ savingFile: false });
    }
  },

  createFile: async (path: string, content?: string, isDirectory?: boolean) => {
    const { currentProject, loadProject } = get();
    if (!currentProject) return;

    await api.files.create(currentProject.id, path, content, isDirectory);
    await loadProject(currentProject.id);
  },

  deleteFile: async (path: string) => {
    const { currentProject, loadProject } = get();
    if (!currentProject) return;

    await api.files.delete(currentProject.id, path);
    await loadProject(currentProject.id);
  },

  setActiveFileContent: (content: string) => {
    set({ activeFileContent: content });
  },

  updateMainFile: async (mainFile: string) => {
    const { currentProject } = get();
    if (!currentProject) return;

    await api.projects.update(currentProject.id, { mainFile });
    set({
      currentProject: { ...currentProject, mainFile },
    });
  },
}));
