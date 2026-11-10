import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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
}
