// This file is intentionally a no-op.
// The mock payment plugin from the template has been replaced by stripe-payment.plugin.ts.
import { FastifyInstance } from 'fastify';

export default async function (_server: FastifyInstance) {
  // no-op
}
