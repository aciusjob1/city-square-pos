export type AppMode = 'staff' | 'waiter';

export const APP_MODE = ((import.meta.env.VITE_APP_MODE as AppMode | undefined) ?? 'staff') as AppMode;

export function getDefaultLoginPath(): string {
  return APP_MODE === 'waiter' ? '/w/login' : '/login';
}

export function getRoleHomePath(role: string): string {
  switch (role) {
    case 'WAITER':
      return '/waiter';
    case 'CASHIER':
      return '/cashier';
    case 'MANAGER':
    case 'ADMIN':
      return '/manager';
    case 'KITCHEN':
      return '/kitchen';
    default:
      return getDefaultLoginPath();
  }
}
