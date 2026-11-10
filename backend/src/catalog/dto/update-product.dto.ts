import {
  IsEnum, IsNumber, IsOptional, IsString, IsUUID,
  MaxLength, Min, MinLength,
} from 'class-validator';
import { Station } from '../../printers/station.enum';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  sku?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sellingPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @IsEnum(Station)
  preparationStation?: Station;
}
