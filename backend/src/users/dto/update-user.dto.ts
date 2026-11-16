import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ROLE_NAMES, RoleName } from './create-user.dto';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsEnum(ROLE_NAMES)
  role?: RoleName;

  // Required when a waiter is moved to another role; ignored for waiters.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  password?: string;

  // Required when a staff member is moved to WAITER; ignored otherwise.
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin?: string;
}
