import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export const STATION_NAMES = ['KITCHEN', 'BAR', 'NONE'] as const;
export type StationName = typeof STATION_NAMES[number];

export const PRINTER_TYPE_NAMES = ['NETWORK', 'OS'] as const;
export type PrinterTypeName = typeof PRINTER_TYPE_NAMES[number];

export class UpdatePrinterDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(\d{1,3}\.){3}\d{1,3}$/, { message: 'ipAddress must be a valid IPv4 address' })
  ipAddress?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsEnum(STATION_NAMES)
  station?: StationName;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(PRINTER_TYPE_NAMES)
  type?: PrinterTypeName;
}
