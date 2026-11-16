import {
  IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min,
} from 'class-validator';

const UNITS = ['G', 'ML', 'PIECES'];

export class CreatePoolDto {
  @IsString()
  @MaxLength(80)
  name: string;

  @IsIn(UNITS)
  unit: 'G' | 'ML' | 'PIECES';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  reorderLevel?: number;
}

export class UpdatePoolDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsIn(UNITS)
  unit?: 'G' | 'ML' | 'PIECES';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  reorderLevel?: number;
}

export class RestockPoolDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10000000)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpsertPoolRecipeDto {
  @IsString()
  productId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  quantityPerUnit: number;
}
