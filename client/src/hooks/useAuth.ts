import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";

export async function fetchAuthUser(): Promise<User | null> {
  const res = await fetch("/api/auth/user", { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

export function useAuth() {
  const { data: user, isPending } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchAuthUser,
    retry: false,
    staleTime: 1000 * 30,
  });

  return {
    user: user ?? undefined,
    isLoading: isPending,
    isAuthenticated: !!user,
  };
}
