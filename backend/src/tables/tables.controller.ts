import {
  Body, Controller, Get, Param, ParseUUIDPipe, Put, Req, UseGuards,
} from '@nestjs/common';
import { TablesService } from './tables.service';
import { SetTableCountDto } from './dto/set-table-count.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('tables')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  list(@Req() req: { user: { userId: string; role: string } }) {
    return this.tables.list(req.user);
  }

  @Get('config')
  @Roles('MANAGER', 'ADMIN')
  config() {
    return this.tables.getConfig();
  }

  @Put('count')
  @Roles('MANAGER', 'ADMIN')
  setCount(@Body() dto: SetTableCountDto) {
    return this.tables.setCount(dto.count);
  }

  @Get(':id/active-order')
  activeOrder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: { user: { userId: string; role: string } },
  ) {
    return this.tables.activeOrderForTable(id, req.user);
  }
}
