const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789',
  'qwerty123', 'admin123', 'letmein1', 'welcome1', 'abc12345',
]);

export interface PasswordValidation {
  ok: boolean;
  errors: string[];
}

export function validatePasswordStrength(password: string): PasswordValidation {
  const errors: string[] = [];
  if (password.length < 8) errors.push('At least 8 characters');
  if (!/[A-Za-z]/.test(password)) errors.push('At least one letter');
  if (!/[0-9]/.test(password)) errors.push('At least one digit');
  if (COMMON_PASSWORDS.has(password.toLowerCase())) errors.push('Too common — choose something less predictable');
  return { ok: errors.length === 0, errors };
}
