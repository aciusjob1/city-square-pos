/**
 * The PC is either a staff terminal or a waiter terminal. The launcher opens
 * `/login` or `/w/login`, and this module remembers which one so that sign-out,
 * session expiry and unauthenticated redirects return to the same login screen
 * instead of always falling back to the staff login.
 */

const TERMINAL_KEY = 'cs_terminal';

export type TerminalMode = 'staff' | 'waiter';

export function getTerminalMode(): TerminalMode {
  return localStorage.getItem(TERMINAL_KEY) === 'waiter' ? 'waiter' : 'staff';
}

export function setTerminalMode(mode: TerminalMode): void {
  localStorage.setItem(TERMINAL_KEY, mode);
}

export function rememberTerminalFromPath(pathname: string): void {
  if (pathname === '/w/login' || pathname.startsWith('/w/')) {
    setTerminalMode('waiter');
  } else if (pathname === '/login') {
    setTerminalMode('staff');
  }
}

export function loginPathForTerminal(mode: TerminalMode = getTerminalMode()): string {
  return mode === 'waiter' ? '/w/login' : '/login';
}
