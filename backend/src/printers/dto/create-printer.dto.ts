import {
  ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsEnum, IsInt, IsOptional,
  IsString, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { PRINTER_TYPE_NAMES, STATION_NAMES } from './update-printer.dto';

export class CreatePrinterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsEnum(PRINTER_TYPE_NAMES)
  type: 'NETWORK' | 'OS';

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(STATION_NAMES, { each: true })
  stations: Array<'KITCHEN' | 'BAR' | 'NONE'>;

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
  @IsBoolean()
  isActive?: boolean;
}
