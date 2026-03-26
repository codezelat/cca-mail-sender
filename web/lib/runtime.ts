export const BACKEND_ORIGIN =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

export function backendAsset(path: string) {
  return `${BACKEND_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}
