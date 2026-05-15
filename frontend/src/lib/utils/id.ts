/**
 * Generate a unique ID using timestamp and random string
 * Works in all browser contexts (HTTP, HTTPS, localhost)
 * Suitable for UI state management (keys, drag-and-drop, etc.)
 */
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}
