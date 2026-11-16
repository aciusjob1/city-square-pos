import { apiFetch } from './api';

export function changeMyPassword(currentPassword: string, newPassword: string) {
  return apiFetch<{ ok: boolean }>('/auth/password', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}
