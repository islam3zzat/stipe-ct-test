import {
  CommercetoolsCartService,
  CommercetoolsPaymentMethodService,
  CommercetoolsPaymentService,
  ErrorInvalidOperation,
  healthCheckCommercetoolsPermissions,
  statusHandler,
} from '@commercetools/connect-payments-sdk';
import Stripe from 'stripe';
import packageJSON from '../../package.json';
import { getConfig } from '../config/config';
import { SupportedPaymentComponentsSchemaDTO } from '../dtos/operations/payment-componets.dto';
import { PaymentModificationStatus } from '../dtos/operations/payment-intents.dto';
import { TransactionDraftDTO, TransactionResponseDTO } from '../dtos/operations/transaction.dto';
import { getCartIdFromContext } from '../libs/fastify/context/context';
import { log } from '../libs/logger';
import { appLogger, paymentSDK } from '../payment-sdk';
import { getStripeClient } from '../stripe/stripe-client';
import { AbstractPaymentService } from './abstract-payment.service';
import { StripeConfigElementResponseSchemaDTO } from '../dtos/stripe-payment.dto';
import {
  CancelPaymentRequest,
  CapturePaymentRequest,
  ConfigResponse,
  PaymentProviderModificationResponse,
  RefundPaymentRequest,
  ReversePaymentRequest,
  StatusResponse,
} from './types/operation.type';

export type StripePaymentServiceOptions = {
  ctCartService: CommercetoolsCartService;
  ctPaymentService: CommercetoolsPaymentService;
  ctPaymentMethodService: CommercetoolsPaymentMethodService;
};

export class StripePaymentService extends AbstractPaymentService {
  constructor(opts: StripePaymentServiceOptions) {
    super(opts.ctCartService, opts.ctPaymentService, opts.ctPaymentMethodService);
  }

  public async initializeCartPayment(): Promise<StripeConfigElementResponseSchemaDTO> {
    const cfg = getConfig();
    const ctCart = await this.ctCartService.getCart({ id: getCartIdFromContext() });
    const amountPlanned = await this.ctCartService.getPaymentAmount({ cart: ctCart });
    return {
      cartInfo: {
        amount: amountPlanned.centAmount,
        currency: amountPlanned.currencyCode,
      },
      captureMethod: cfg.stripeCaptureMethod,
      collectBillingAddress: cfg.stripeCollectBillingAddress,
      layout: JSON.stringify({ type: 'tabs', defaultCollapsed: false }),
    };
  }

  public async config(): Promise<ConfigResponse> {
    const cfg = getConfig();
    return {
      publishableKey: cfg.stripePublishableKey,
      captureMethod: cfg.stripeCaptureMethod,
      collectBillingAddress: cfg.stripeCollectBillingAddress,
      merchantReturnUrl: cfg.merchantReturnUrl,
      paymentInterface: cfg.paymentInterface,
    };
  }

  public async status(): Promise<StatusResponse> {
    const stripe = getStripeClient();

    const handler = await statusHandler({
      timeout: getConfig().healthCheckTimeout,
      log: appLogger,
      checks: [
        healthCheckCommercetoolsPermissions({
          requiredPermissions: [
            'manage_payments',
            'view_sessions',
            'view_api_clients',
            'manage_orders',
            'introspect_oauth_tokens',
            'manage_checkout_payment_intents',
            'manage_types',
          ],
          ctAuthorizationService: paymentSDK.ctAuthorizationService,
          projectKey: getConfig().projectKey,
        }),
        async () => {
          try {
            // Lightweight Stripe connectivity check — list one payment method type
            await stripe.paymentMethodConfigurations.list({ limit: 1 });
            return { name: 'Stripe API', status: 'UP', message: 'Stripe API reachable' };
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            log.error('Stripe health check failed', { error: msg });
            return { name: 'Stripe API', status: 'DOWN', message: msg };
          }
        },
      ],
      metadataFn: async () => ({
        name: packageJSON.name,
        description: packageJSON.description,
        '@commercetools/connect-payments-sdk': packageJSON.dependencies['@commercetools/connect-payments-sdk'],
      }),
    })();

    return handler.body;
  }

  public async getSupportedPaymentComponents(): Promise<SupportedPaymentComponentsSchemaDTO> {
    return {
      dropins: [{ type: 'embedded' }],
      components: [{ type: 'card' }],
      express: [],
    };
  }

  /**
   * Create a Stripe PaymentIntent for the cart currently in context.
   * Called by the POST /payments route (the enabler triggers this via the session).
   */
  public async createPaymentIntent(): Promise<{ clientSecret: string; paymentReference: string }> {
    const stripe = getStripeClient();
    const cfg = getConfig();
    const cartId = getCartIdFromContext();

    const ctCart = await this.ctCartService.getCart({ id: cartId });
    const amountPlanned = await this.ctCartService.getPaymentAmount({ cart: ctCart });

    // Create the CT Payment — processor owns this object
    const ctPayment = await this.ctPaymentService.createPayment({
      amountPlanned,
      paymentMethodInfo: { paymentInterface: cfg.paymentInterface },
      ...(ctCart.customerId && { customer: { typeId: 'customer', id: ctCart.customerId } }),
      ...(!ctCart.customerId && ctCart.anonymousId && { anonymousId: ctCart.anonymousId }),
    });

    await this.ctCartService.addPayment({
      resource: { id: ctCart.id, version: ctCart.version },
      paymentId: ctPayment.id,
    });

    // Create the Stripe PaymentIntent
    const intent = await stripe.paymentIntents.create({
      amount: amountPlanned.centAmount,
      currency: amountPlanned.currencyCode.toLowerCase(),
      capture_method: cfg.stripeCaptureMethod,
      payment_method_types: ['card'],
      metadata: {
        ctPaymentId: ctPayment.id,
        ctCartId: ctCart.id,
        ctProjectKey: cfg.projectKey,
      },
    });

    // Store the Stripe PaymentIntent ID as the PSP reference and record Initial Authorization
    await this.ctPaymentService.updatePayment({
      id: ctPayment.id,
      pspReference: intent.id,
      paymentMethod: 'card',
      transaction: {
        type: 'Authorization',
        amount: amountPlanned,
        interactionId: intent.id,
        state: 'Initial',
      },
    });

    log.info('Stripe PaymentIntent created', { intentId: intent.id, ctPaymentId: ctPayment.id });

    return { clientSecret: intent.client_secret!, paymentReference: ctPayment.id };
  }

  /**
   * Handle inbound Stripe webhook events.
   * The processor verifies the signature and updates CT Payment transaction state.
   */
  public async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const stripe = getStripeClient();
    const cfg = getConfig();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, cfg.stripeWebhookSigningSecret);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('Stripe webhook signature verification failed', { error: msg });
      throw new ErrorInvalidOperation('Invalid webhook signature');
    }

    log.info('Stripe webhook received', { type: event.type, id: event.id });

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.onPaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        await this.onPaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.amount_capturable_updated':
        await this.onPaymentIntentAuthorized(event.data.object as Stripe.PaymentIntent);
        break;
      case 'charge.refunded':
        await this.onChargeRefunded(event.data.object as Stripe.Charge);
        break;
      default:
        log.info('Stripe webhook event ignored (unhandled type)', { type: event.type });
    }
  }

  private async onPaymentIntentSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
    const ctPaymentId = intent.metadata?.ctPaymentId;
    if (!ctPaymentId) return;

    const ctPayment = await this.ctPaymentService.getPayment({ id: ctPaymentId });

    const alreadyCharged = this.ctPaymentService.hasTransactionInState({
      payment: ctPayment,
      transactionType: 'Charge',
      states: ['Success'],
    });
    if (alreadyCharged) return; // idempotent

    await this.ctPaymentService.updatePayment({
      id: ctPaymentId,
      transaction: {
        type: 'Charge',
        amount: ctPayment.amountPlanned,
        interactionId: intent.id,
        state: 'Success',
      },
    });

    // Also mark the Authorization as Success if still Initial/Pending
    const authPending = this.ctPaymentService.hasTransactionInState({
      payment: ctPayment,
      transactionType: 'Authorization',
      states: ['Initial', 'Pending'],
    });
    if (authPending) {
      await this.ctPaymentService.updatePayment({
        id: ctPaymentId,
        transaction: {
          type: 'Authorization',
          amount: ctPayment.amountPlanned,
          interactionId: intent.id,
          state: 'Success',
        },
      });
    }

    log.info('CT Payment updated: Charge Success', { ctPaymentId, intentId: intent.id });
  }

  private async onPaymentIntentAuthorized(intent: Stripe.PaymentIntent): Promise<void> {
    const ctPaymentId = intent.metadata?.ctPaymentId;
    if (!ctPaymentId) return;

    const ctPayment = await this.ctPaymentService.getPayment({ id: ctPaymentId });
    const authAlreadySuccess = this.ctPaymentService.hasTransactionInState({
      payment: ctPayment,
      transactionType: 'Authorization',
      states: ['Success'],
    });
    if (authAlreadySuccess) return;

    await this.ctPaymentService.updatePayment({
      id: ctPaymentId,
      transaction: {
        type: 'Authorization',
        amount: ctPayment.amountPlanned,
        interactionId: intent.id,
        state: 'Success',
      },
    });

    log.info('CT Payment updated: Authorization Success', { ctPaymentId, intentId: intent.id });
  }

  private async onPaymentIntentFailed(intent: Stripe.PaymentIntent): Promise<void> {
    const ctPaymentId = intent.metadata?.ctPaymentId;
    if (!ctPaymentId) return;

    const ctPayment = await this.ctPaymentService.getPayment({ id: ctPaymentId });
    await this.ctPaymentService.updatePayment({
      id: ctPaymentId,
      transaction: {
        type: 'Authorization',
        amount: ctPayment.amountPlanned,
        interactionId: intent.id,
        state: 'Failure',
      },
    });

    log.info('CT Payment updated: Authorization Failure', { ctPaymentId, intentId: intent.id });
  }

  private async onChargeRefunded(charge: Stripe.Charge): Promise<void> {
    const intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (!intentId) return;

    // Look up the CT Payment by pspReference (Stripe intent ID)
    const { results } = await paymentSDK.ctAPI.client
      .payments()
      .get({ queryArgs: { where: `interfaceId="${intentId}"`, limit: 1 } })
      .execute()
      .then((r) => r.body);

    if (!results.length) {
      log.warn('No CT Payment found for Stripe charge refund', { intentId });
      return;
    }

    const ctPayment = results[0];
    const refundAmount = charge.amount_refunded;

    await this.ctPaymentService.updatePayment({
      id: ctPayment.id,
      transaction: {
        type: 'Refund',
        amount: { centAmount: refundAmount, currencyCode: charge.currency.toUpperCase() },
        interactionId: intentId,
        state: 'Success',
      },
    });

    log.info('CT Payment updated: Refund Success', { ctPaymentId: ctPayment.id, intentId });
  }

  // ── Post-purchase operations (called from fulfillment backend, not storefront) ──

  public async capturePayment(request: CapturePaymentRequest): Promise<PaymentProviderModificationResponse> {
    const stripe = getStripeClient();
    const intentId = request.payment.interfaceId;
    if (!intentId) throw new ErrorInvalidOperation('Payment has no PSP reference (Stripe intent ID)');

    const captureParams: Stripe.PaymentIntentCaptureParams = {};
    if (request.amount) captureParams.amount_to_capture = request.amount.centAmount;

    await stripe.paymentIntents.capture(intentId, captureParams);

    await this.ctPaymentService.updatePayment({
      id: request.payment.id,
      transaction: {
        type: 'Charge',
        amount: request.amount ?? request.payment.amountPlanned,
        interactionId: intentId,
        state: 'Pending', // webhook will move it to Success
      },
    });

    log.info('Stripe PaymentIntent capture initiated', { intentId });
    return { outcome: PaymentModificationStatus.APPROVED, pspReference: intentId };
  }

  public async cancelPayment(request: CancelPaymentRequest): Promise<PaymentProviderModificationResponse> {
    const stripe = getStripeClient();
    const intentId = request.payment.interfaceId;
    if (!intentId) throw new ErrorInvalidOperation('Payment has no PSP reference');

    await stripe.paymentIntents.cancel(intentId);

    await this.ctPaymentService.updatePayment({
      id: request.payment.id,
      transaction: {
        type: 'CancelAuthorization',
        amount: request.payment.amountPlanned,
        interactionId: intentId,
        state: 'Success',
      },
    });

    log.info('Stripe PaymentIntent cancelled', { intentId });
    return { outcome: PaymentModificationStatus.APPROVED, pspReference: intentId };
  }

  public async refundPayment(request: RefundPaymentRequest): Promise<PaymentProviderModificationResponse> {
    const stripe = getStripeClient();
    const intentId = request.payment.interfaceId;
    if (!intentId) throw new ErrorInvalidOperation('Payment has no PSP reference');

    const refundParams: Stripe.RefundCreateParams = { payment_intent: intentId };
    if (request.amount) refundParams.amount = request.amount.centAmount;

    const refund = await stripe.refunds.create(refundParams);

    await this.ctPaymentService.updatePayment({
      id: request.payment.id,
      transaction: {
        type: 'Refund',
        amount: request.amount ?? request.payment.amountPlanned,
        interactionId: refund.id,
        state: 'Pending', // webhook confirms via charge.refunded
      },
    });

    log.info('Stripe refund created', { refundId: refund.id, intentId });
    return { outcome: PaymentModificationStatus.APPROVED, pspReference: refund.id };
  }

  public async reversePayment(request: ReversePaymentRequest): Promise<PaymentProviderModificationResponse> {
    const hasCharge = this.ctPaymentService.hasTransactionInState({
      payment: request.payment,
      transactionType: 'Charge',
      states: ['Success'],
    });
    const hasAuth = this.ctPaymentService.hasTransactionInState({
      payment: request.payment,
      transactionType: 'Authorization',
      states: ['Success'],
    });
    const alreadyReverted =
      this.ctPaymentService.hasTransactionInState({ payment: request.payment, transactionType: 'Refund', states: ['Success', 'Pending'] }) ||
      this.ctPaymentService.hasTransactionInState({ payment: request.payment, transactionType: 'CancelAuthorization', states: ['Success', 'Pending'] });

    if (alreadyReverted) throw new ErrorInvalidOperation('Payment has already been reversed');

    if (hasCharge) return this.refundPayment({ payment: request.payment, merchantReference: request.merchantReference, amount: request.payment.amountPlanned });
    if (hasAuth) return this.cancelPayment({ payment: request.payment, merchantReference: request.merchantReference });

    throw new ErrorInvalidOperation('No successful transaction to reverse');
  }

  public async handleTransaction(transactionDraft: TransactionDraftDTO): Promise<TransactionResponseDTO> {
    // Transactions endpoint is not used in this direct-connector flow.
    // The enabler drives payment creation via POST /payments which calls createPaymentIntent().
    throw new ErrorInvalidOperation('handleTransaction is not supported — use POST /payments');
  }
}
