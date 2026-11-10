import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards,
} from '@nestjs/common';
import { IsArray, ArrayMinSize, IsUUID, IsString } from 'class-validator';
import { BillGroupsService } from './bill-groups.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from './orders.service';

class MergeOrdersDto {
  @IsArray()
  @ArrayMinSize(2)
  @IsUUID('all', { each: true })
  orderIds: string[];
}

class BillGroupIdDto {
  @IsString()
  @IsUUID()
  billGroupId: string;
}

@Controller('bill-groups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BillGroupsController {
  constructor(private readonly billGroups: BillGroupsService) {}

  @Post('merge')
  @Roles('CASHIER', 'MANAGER', 'ADMIN')
  merge(@Body() dto: MergeOrdersDto, @Req() req: { user: AuthUser }) {
    return this.billGroups.merge(dto.orderIds, req.user);
  }

  @Post('unmerge')
  @Roles('CASHIER', 'MANAGER', 'ADMIN')
  unmerge(@Body() dto: BillGroupIdDto, @Req() req: { user: AuthUser }) {
    return this.billGroups.unmerge(dto.billGroupId, req.user);
  }

  @Post(':billGroupId/print')
  @Roles('CASHIER', 'MANAGER', 'ADMIN')
  printConsolidated(
    @Param('billGroupId', new ParseUUIDPipe()) billGroupId: string,
    @Req() req: { user: AuthUser },
  ) {
    return this.billGroups.printConsolidatedBill(billGroupId, req.user);
  }

  @Get(':billGroupId')
  @Roles('CASHIER', 'MANAGER', 'ADMIN')
  getOne(@Param('billGroupId', new ParseUUIDPipe()) billGroupId: string) {
    return this.billGroups.getBillGroup(billGroupId);
  }
}
