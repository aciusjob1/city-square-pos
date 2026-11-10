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

  // Merge: WAITER can merge their own orders (ownership enforced in service).
  @Post('merge')
  @Roles('WAITER', 'CASHIER', 'MANAGER', 'ADMIN')
  merge(@Body() dto: MergeOrdersDto, @Req() req: { user: AuthUser }) {
    return this.billGroups.merge(dto.orderIds, req.user);
  }

  // Unmerge: cashier+ only — dissolving a group can affect cross-waiter orders.
  @Post('unmerge')
  @Roles('CASHIER', 'MANAGER', 'ADMIN')
  unmerge(@Body() dto: BillGroupIdDto, @Req() req: { user: AuthUser }) {
    return this.billGroups.unmerge(dto.billGroupId, req.user);
  }

  // Print consolidated bill: cashier+ only — this is the final billing action.
  @Post(':billGroupId/print')
  @Roles('CASHIER', 'MANAGER', 'ADMIN')
  printConsolidated(
    @Param('billGroupId', new ParseUUIDPipe()) billGroupId: string,
    @Req() req: { user: AuthUser },
  ) {
    return this.billGroups.printConsolidatedBill(billGroupId, req.user);
  }

  // Get: WAITER can view their own groups (ownership enforced in service).
  @Get(':billGroupId')
  @Roles('WAITER', 'CASHIER', 'MANAGER', 'ADMIN')
  getOne(
    @Param('billGroupId', new ParseUUIDPipe()) billGroupId: string,
    @Req() req: { user: AuthUser },
  ) {
    return this.billGroups.getBillGroup(billGroupId, req.user);
  }
}
