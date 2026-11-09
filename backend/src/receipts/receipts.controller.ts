import {
  Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards,
} from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { RequestBillDto } from './dto/request-bill.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../orders/orders.service';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Post(':id/bill')
  @Roles('WAITER', 'CASHIER', 'MANAGER', 'ADMIN')
  requestBill(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RequestBillDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.receipts.requestBill(id, dto.clientUuid, req.user);
  }
}
