import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  // KITCHEN/BAR route prep tickets; NONE means the receipt printer
  // (no kitchen/bar ticket — items only appear on the customer receipt).
  @IsOptional()
  @IsIn(['KITCHEN', 'BAR', 'NONE'])
  printerStation?: 'KITCHEN' | 'BAR' | 'NONE' | null;
}
