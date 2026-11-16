import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class SetTableCountDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  count: number;
}
