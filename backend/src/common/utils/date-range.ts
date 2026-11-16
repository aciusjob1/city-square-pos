import { BadRequestException } from '@nestjs/common';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateRange(
  fromRaw?: string,
  toRaw?: string,
): { from: string | null; to: string | null } {
  const from = (fromRaw ?? '').trim() || null;
  const to = (toRaw ?? '').trim() || null;
  if (from && !DATE_RE.test(from)) {
    throw new BadRequestException('from must be YYYY-MM-DD');
  }
  if (to && !DATE_RE.test(to)) {
    throw new BadRequestException('to must be YYYY-MM-DD');
  }
  if (from && to && from > to) {
    throw new BadRequestException('from must be on or before to');
  }
  return { from, to };
}
