import { io } from 'socket.io-client'

export const API_BASE = import.meta.env.VITE_API_BASE || ''
const SOCKET_BASE = import.meta.env.VITE_SOCKET_BASE
export const TOKEN_KEY = 'sameria-token-v1'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(token) {
  if (!token) {
    localStorage.removeItem(TOKEN_KEY)
    return
  }
  localStorage.setItem(TOKEN_KEY, token)
}

export class ApiError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = details.status
    this.retryAfter = details.retryAfter
    this.issues = details.issues || []
  }
}

export async function api(path, options = {}) {
  const { method = 'GET', body, token } = options
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
  const headers = isFormData ? {} : { 'Content-Type': 'application/json' }
  const authToken = token ?? getToken()
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(data.message || 'Request failed', {
      status: response.status,
      retryAfter: response.headers.get('retry-after'),
      issues: data.issues,
    })
  }
  return data
}

export function createChatSocket() {
  if (SOCKET_BASE) {
    return io(SOCKET_BASE, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: true,
    })
  }

  return io({
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    autoConnect: true,
  })
}
