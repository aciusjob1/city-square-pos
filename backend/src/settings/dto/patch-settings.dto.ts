import { IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class PatchSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  restaurant_name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @ValidateIf((o) => o['printer.default.kitchen'] !== null)
  @IsUUID()
  'printer.default.kitchen'?: string | null;

  @IsOptional()
  @ValidateIf((o) => o['printer.default.bar'] !== null)
  @IsUUID()
  'printer.default.bar'?: string | null;

  @IsOptional()
  @ValidateIf((o) => o['printer.default.receipt'] !== null)
  @IsUUID()
  'printer.default.receipt'?: string | null;
}
