/**
 * apiClient.js – API communication client
 *
 * Base URL: /api/v1 (proxied by Vite to http://localhost:4000)
 * Automatically attaches Authorization: Bearer <token> if present in localStorage.
 * Throws structured ApiError { status, code, message, details }.
 * On 401 from a protected request, clears stored auth and redirects to /login.
 */

export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const BASE_URL = '/api/v1';

export async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem('pl_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;

  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers,
    });
  } catch (netErr) {
    throw new ApiError(0, 'NETWORK_ERROR', 'Network connection error. Please check your internet connection.');
  }

  // 204 No Content
  if (res.status === 204) {
    return null;
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorObj = data.error || {};
    const status = res.status;
    const code = errorObj.code || 'UNKNOWN_ERROR';
    const message = errorObj.message || res.statusText || 'Request failed';
    const details = errorObj.details || {};

    // On 401 Unauthorized from a protected call, clear credentials and redirect to login
    if (status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/register')) {
      localStorage.removeItem('pl_token');
      localStorage.removeItem('pl_user');
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
      }
    }

    throw new ApiError(status, code, message, details);
  }

  return data;
}

export const api = {
  get: (endpoint, options) => apiRequest(endpoint, { ...options, method: 'GET' }),
  post: (endpoint, body, options) =>
    apiRequest(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) }),
  delete: (endpoint, options) => apiRequest(endpoint, { ...options, method: 'DELETE' }),
};
