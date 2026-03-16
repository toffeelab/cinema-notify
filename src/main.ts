import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { createServer } from 'http';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Health check 서버를 NestJS 초기화보다 먼저 시작.
  // onModuleInit(DB 연결, Discord 봇 로그인 등)이 오래 걸리면
  // Render 헬스체크 타임아웃이 발생하므로 포트를 먼저 열어야 한다.
  const port = process.env.PORT || 3333;
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.end('ok');
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`Port ${port} in use, skipping health check server`);
    } else {
      logger.error(`Health check server error: ${err.message}`);
    }
  });
  server.listen(port, () => {
    logger.log(`Health check listening on port ${port}`);
  });

  const app = await NestFactory.createApplicationContext(AppModule);
  logger.log('Cinema notify bot started');

  // Render 무료 플랜 spin down 방지: 10분마다 self-ping
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) {
    const KEEP_ALIVE_MS = 10 * 60 * 1000;
    setInterval(() => {
      fetch(renderUrl).catch(() => {});
    }, KEEP_ALIVE_MS);
    logger.log(`Keep-alive ping enabled: ${renderUrl}`);
  }

  const shutdown = () => {
    logger.log('Shutting down...');
    void app.close().then(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
void bootstrap();
