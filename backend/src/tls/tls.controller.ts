import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { getTlsMaterial } from '../common/tls';

@Controller('tls')
export class TlsController {
  @Get('info')
  info(@Req() req: Request) {
    const tls = getTlsMaterial();
    const secure = Boolean(req.socket && (req.socket as { encrypted?: boolean }).encrypted);
    return {
      enabled: tls !== null,
      secure,
      port: tls?.httpsPort ?? null,
      redirectPort: tls && tls.redirectPort > 0 ? tls.redirectPort : null,
      certificateUrl: tls?.certificatePath ? '/api/tls/certificate' : null,
      certificate: tls?.certificate ?? null,
    };
  }

  @Get('certificate')
  certificate(@Res() res: Response) {
    const tls = getTlsMaterial();
    if (!tls || !tls.certificatePath) {
      res.status(404).json({
        statusCode: 404,
        error: 'Not Found',
        message: 'This server does not publish a certificate.',
      });
      return;
    }
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="CitySquarePOS.cer"',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(tls.certificatePath);
  }
}
