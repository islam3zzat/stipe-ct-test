import { FastifyInstance } from 'fastify';
import { paymentSDK } from '../../payment-sdk';
import { stripePaymentRoutes } from '../../routes/stripe-payment.route';
import { StripePaymentService } from '../../services/stripe-payment.service';

export default async function (server: FastifyInstance) {
  const stripePaymentService = new StripePaymentService({
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
    ctPaymentMethodService: paymentSDK.ctPaymentMethodService,
  });

  await server.register(stripePaymentRoutes, {
    paymentService: stripePaymentService,
    sessionHeaderAuthHook: paymentSDK.sessionHeaderAuthHookFn,
  });
}
