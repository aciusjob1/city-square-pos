import {
  ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString,
  IsUUID, Min, MaxLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum OrderTypeEnum {
  DINE_IN = 'DINE_IN',
  TAKEAWAY = 'TAKEAWAY',
  DELIVERY = 'DELIVERY',
}

export class CreateOrderItemDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateOrderDto {
  @IsUUID()
  clientUuid: string;

  @IsOptional()
  @IsUUID()
  tableId?: string;

  @IsEnum(OrderTypeEnum)
  orderType: OrderTypeEnum;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
