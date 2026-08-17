type ApiErrorShape = { error?: { code?: string; message?: string } };

const apiBasePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function apiUrl(path: string) { return `${apiBasePath}${path}`; }

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = 'API_ERROR') { super(message); this.status = status; this.code = code; }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'same-origin',
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as ApiErrorShape;
    throw new ApiError(payload.error?.message || `请求失败（${response.status}）`, response.status, payload.error?.code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function jsonBody(value: unknown): Pick<RequestInit, 'body'> { return { body: JSON.stringify(value) }; }
