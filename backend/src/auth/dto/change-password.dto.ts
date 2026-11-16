import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  currentPassword: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  newPassword: string;
}
