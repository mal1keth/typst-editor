import { create } from "zustand";
import { api, type User } from "@/lib/api";

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  checkAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  error: null,

  checkAuth: async () => {
    try {
      const user = await api.auth.me();
      set({ user, loading: false, error: null });
    } catch {
      set({ user: null, loading: false, error: null });
    }
  },

  logout: async () => {
    await api.auth.logout();
    set({ user: null });
  },
}));
