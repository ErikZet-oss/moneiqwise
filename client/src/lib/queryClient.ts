import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const PORTFOLIO_QUERY_CACHE_KEY = "portfolio-query-cache";
const CACHE_MAX_AGE = 1000 * 60 * 60; // 1 hour

function isAuthUserQueryKey(key: unknown): boolean {
  try {
    return JSON.stringify(key).includes("/api/auth/user");
  } catch {
    return false;
  }
}

function loadCachedData(): Record<string, unknown> | null {
  try {
    const cached = localStorage.getItem(PORTFOLIO_QUERY_CACHE_KEY);
    if (!cached) return null;
    
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_MAX_AGE) {
      localStorage.removeItem(PORTFOLIO_QUERY_CACHE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function saveCacheData(data: Record<string, unknown>) {
  try {
    localStorage.setItem(PORTFOLIO_QUERY_CACHE_KEY, JSON.stringify({
      data,
      timestamp: Date.now()
    }));
  } catch {
    // Ignore storage errors
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      // Default: treat data as fresh for 5 minutes. Quotes that need to be
      // fresher (during market hours) should override this on the individual
      // useQuery call. Mutations invalidate their relevant queries explicitly,
      // so stale-while-revalidate UX is preserved: the hydrated localStorage
      // cache renders instantly on load and only refetches when actually stale.
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 60 * 2, // Keep unused data in cache for 2 hours
      refetchOnWindowFocus: false, // Do not refetch simply because the tab regained focus
      refetchOnReconnect: true, // Refetch when connection is restored
      refetchOnMount: false, // Rely on staleTime; don't hammer on every mount
      refetchInterval: false,
      retry: 1, // Retry once on failure
      retryDelay: 1000,
    },
    mutations: {
      retry: false,
    },
  },
});

// Hydrate cache from localStorage on startup
const cachedData = loadCachedData();
if (cachedData) {
  Object.entries(cachedData).forEach(([key, value]) => {
    try {
      const queryKey = JSON.parse(key);
      if (isAuthUserQueryKey(queryKey)) return;
      queryClient.setQueryData(queryKey, value);
    } catch {
      // Ignore invalid cache entries
    }
  });
}

// Save cache to localStorage periodically
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

queryClient.getQueryCache().subscribe(() => {
  if (saveTimeout) clearTimeout(saveTimeout);
  
  saveTimeout = setTimeout(() => {
    const queries = queryClient.getQueryCache().getAll();
    const cacheData: Record<string, unknown> = {};
    
    queries.forEach(query => {
      if (query.state.data !== undefined && query.state.status === 'success') {
        const key = JSON.stringify(query.queryKey);
        if (key.includes("/api/auth/user")) return;
        // Only cache portfolio-related data
        if (key.includes('/api/')) {
          cacheData[key] = query.state.data;
        }
      }
    });
    
    saveCacheData(cacheData);
  }, 1000);
});
