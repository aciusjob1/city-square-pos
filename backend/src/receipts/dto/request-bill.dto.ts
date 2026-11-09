import { IsUUID } from 'class-validator';

export class RequestBillDto {
  @IsUUID()
  clientUuid: string;
}
