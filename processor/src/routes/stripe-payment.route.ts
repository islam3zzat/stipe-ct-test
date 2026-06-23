import { SessionHeaderAuthenticationHook } from '@commercetools/connect-payments-sdk';
import { Type } from '@sinclair/typebox';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  StripeConfigElementResponseSchema,
  StripeConfigElementResponseSchemaDTO,
  StripeCreatePaymentResponseSchema,
  StripeCreatePaymentResponseSchemaDTO,
} from '../dtos/stripe-payment.dto';
import { StripePaymentService } from '../services/stripe-payment.service';

type StripePaymentRoutesOptions = {
  paymentService: StripePaymentService;
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
};

export const stripePaymentRoutes = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & StripePaymentRoutesOptions,
) => {
  /**
   * GET /config-element/:paymentComponent
   * Returns cart amount/currency + Stripe Elements config so the enabler can
   * initialize stripe.elements() in deferred-intent mode before submit.
   */
  fastify.get<{ Params: { paymentComponent: string }; Reply: StripeConfigElementResponseSchemaDTO }>(
    '/config-element/:paymentComponent',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        params: {
          type: 'object',
          properties: { paymentComponent: Type.String() },
          required: ['paymentComponent'],
        },
        response: { 200: StripeConfigElementResponseSchema },
      },
    },
    async (_, reply) => {
      const result = await opts.paymentService.initializeCartPayment();
      return reply.status(200).send(result);
    },
  );

  /**
   * POST /payments
   * Called by the enabler after the customer submits the Payment Element.
   * Creates a Stripe PaymentIntent + CT Payment and returns the client_secret.
   */
  fastify.post<{ Reply: StripeCreatePaymentResponseSchemaDTO }>(
    '/payments',
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        response: {
          200: StripeCreatePaymentResponseSchema,
        },
      },
    },
    async (_, reply) => {
      const result = await opts.paymentService.createPaymentIntent();
      return reply.status(200).send(result);
    },
  );

  /**
   * POST /stripe/webhooks
   * Receives Stripe webhook events.
   * Content-Type: application/json (raw body needed for signature verification).
   * No session auth — Stripe authenticates via HMAC signature.
   */
  fastify.post(
    '/stripe/webhooks',
    {
      config: { rawBody: true },
    },
    async (request, reply) => {
      const signature = (request.headers['stripe-signature'] as string) ?? '';

      // rawBody is populated by the raw body plugin registered in server.ts
      const rawBody: Buffer = (request as unknown as { rawBody: Buffer }).rawBody;

      await opts.paymentService.handleWebhook(rawBody, signature);
      return reply.status(200).send({ received: true });
    },
  );
};
