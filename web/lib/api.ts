function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function resolveApiBaseUrl() {
  const envBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "");
  if (typeof window !== "undefined" && isLoopbackHost(window.location.hostname)) {
    const base = envBaseUrl ? new URL(envBaseUrl) : new URL("http://127.0.0.1:8000");
    base.protocol = window.location.protocol === "https:" ? "https:" : "http:";
    base.hostname = window.location.hostname;
    if (!base.port) {
      base.port = "8000";
    }
    return base.origin;
  }
  return envBaseUrl || "http://127.0.0.1:8000";
}

const API_BASE_URL = resolveApiBaseUrl();

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${name}=`))
    ?.split("=")[1];
}

type ApiOptions = RequestInit & {
  bodyJson?: unknown;
};

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { bodyJson, headers, ...rest } = options;
  const requestHeaders = new Headers(headers || {});
  const method = (rest.method || "GET").toUpperCase();

  if (bodyJson !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(method) && typeof document !== "undefined") {
    const csrfToken = readCookie("cca_csrf");
    if (csrfToken) {
      requestHeaders.set("X-CSRF-Token", decodeURIComponent(csrfToken));
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: requestHeaders,
    credentials: "include",
    body: bodyJson !== undefined ? JSON.stringify(bodyJson) : rest.body
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const detail =
      typeof data === "string"
        ? data
        : (data as { detail?: string }).detail || "Request failed";
    throw new Error(detail);
  }

  return data as T;
}

export function buildUploadForm(entries: Record<string, string | File | Blob | boolean | number>) {
  const formData = new FormData();
  Object.entries(entries).forEach(([key, value]) => {
    if (value instanceof File || value instanceof Blob) {
      formData.append(key, value);
      return;
    }
    formData.append(key, String(value));
  });
  return formData;
}

export { API_BASE_URL, resolveApiBaseUrl };
