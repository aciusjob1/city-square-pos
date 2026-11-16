import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  // null clears the override so each product's own station decides again.
  @IsOptional()
  @IsIn(['KITCHEN', 'BAR', 'NONE'])
  printerStation?: 'KITCHEN' | 'BAR' | 'NONE' | null;
}
