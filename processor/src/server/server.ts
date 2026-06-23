import autoLoad from '@fastify/autoload';
import cors from '@fastify/cors';
import fastifyFormBody from '@fastify/formbody';
import Fastify from 'fastify';
import rawBody from 'fastify-raw-body';
import { randomUUID } from 'node:crypto';
import { join } from 'path';
import { getConfig } from '../config/config';
import { requestContextPlugin } from '../libs/fastify/context/context';
import { errorHandler } from '../libs/fastify/error-handler';

export const setupFastify = async () => {
  const cfg = getConfig();

  const server = Fastify({
    logger: { level: cfg.loggerLevel },
    genReqId: () => randomUUID().toString(),
    requestIdLogLabel: 'requestId',
    requestIdHeader: 'x-request-id',
  });

  server.setErrorHandler(errorHandler);

  // Raw body plugin — needed for Stripe webhook HMAC verification
  await server.register(rawBody, {
    field: 'rawBody',
    global: false,
    encoding: false, // keep as Buffer
    runFirst: true,
    routes: ['/stripe/webhooks'],
  });

  // CORS — restrict to configured origins (fail-open to '*' only if allowedOrigins is empty)
  await server.register(cors, {
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'X-Request-ID', 'X-Session-ID'],
    methods: ['GET', 'HEAD', 'POST', 'DELETE'],
    origin: cfg.allowedOrigins.length ? cfg.allowedOrigins : true,
  });

  await server.register(fastifyFormBody);
  await server.register(requestContextPlugin);

  await server.register(autoLoad, {
    dir: join(__dirname, 'plugins'),
  });

  return server;
};
