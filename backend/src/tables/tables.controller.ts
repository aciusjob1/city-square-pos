import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { TablesService } from './tables.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('tables')
@UseGuards(JwtAuthGuard)
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  list() {
    return this.tables.list();
  }

  @Get(':id/active-order')
  activeOrder(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.tables.activeOrderForTable(id);
  }
}
