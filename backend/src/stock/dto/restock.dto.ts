import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class RestockDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  @Max(100000)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
