import { IsBoolean, IsOptional } from 'class-validator';

export class DayActionDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
