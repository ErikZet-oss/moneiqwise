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
    // Must stay 0: unauthenticated responses cache `null` as success. With a
    // positive staleTime, post-login fetchQuery/invalidate would skip the
    // network for 30s and the UI stayed on Landing until a full reload.
    staleTime: 0,
  });

  return {
    user: user ?? undefined,
    isLoading: isPending,
    isAuthenticated: !!user,
  };
}
