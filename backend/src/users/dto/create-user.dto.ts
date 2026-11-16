import {
  IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf,
} from 'class-validator';

export const ROLE_NAMES = ['ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN'] as const;
export type RoleName = typeof ROLE_NAMES[number];

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9_.-]+$/, { message: 'Username may contain letters, digits, dot, dash, underscore only' })
  username: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  fullName: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsEnum(ROLE_NAMES)
  role: RoleName;

  // Waiters sign in with a PIN, so staff passwords are only required for the
  // other roles.
  @ValidateIf((o) => o.role !== 'WAITER')
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  password?: string;

  @ValidateIf((o) => o.role === 'WAITER' || o.pin !== undefined)
  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin?: string;
}
