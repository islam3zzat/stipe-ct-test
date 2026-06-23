import { loadStripe, Stripe, StripeElements } from "@stripe/stripe-js";
import {
  DropinType,
  EnablerOptions,
  PaymentComponentBuilder,
  PaymentDropinBuilder,
  PaymentEnabler,
  PaymentExpressBuilder,
  PaymentResult,
  StoredComponentBuilder,
} from "./payment-enabler";
import { StripeDropinEmbeddedBuilder } from "../dropin/dropin-embedded";

export type StripeBaseOptions = {
  processorUrl: string;
  sessionId: string;
  locale?: string;
  stripe: Stripe;
  elements: StripeElements;
  publishableKey: string;
  merchantReturnUrl: string;
  onComplete: (result: PaymentResult) => void;
  onError: (error: unknown, context?: { paymentReference?: string }) => void;
};

export class StripePaymentEnabler implements PaymentEnabler {
  private setupData: Promise<{ baseOptions: StripeBaseOptions }>;

  constructor(options: EnablerOptions) {
    this.setupData = StripePaymentEnabler._setup(options);
  }

  private static _setup = async (
    options: EnablerOptions,
  ): Promise<{ baseOptions: StripeBaseOptions }> => {
    // Fetch Stripe publishable key + return URL from the processor
    const fetchHeaders = {
      "Content-Type": "application/json",
      "X-Session-Id": options.sessionId,
    };

    // Fetch processor config (publishableKey, merchantReturnUrl) and cart info in parallel
    const [configRes, cartElementRes] = await Promise.all([
      fetch(`${options.processorUrl}/operations/config`, { method: "GET", headers: fetchHeaders }),
      fetch(`${options.processorUrl}/config-element/payment`, { method: "GET", headers: fetchHeaders }),
    ]);

    if (!configRes.ok) {
      throw new Error(`Failed to load processor config: ${configRes.status} ${configRes.statusText}`);
    }
    if (!cartElementRes.ok) {
      throw new Error(`Failed to load cart element config: ${cartElementRes.status} ${cartElementRes.statusText}`);
    }

    const config: { publishableKey: string; merchantReturnUrl: string } = await configRes.json();
    const cartElement: { cartInfo: { amount: number; currency: string }; captureMethod: string } = await cartElementRes.json();

    if (!config.publishableKey) {
      throw new Error("Processor config missing publishableKey");
    }

    const stripe = await loadStripe(config.publishableKey, {
      locale: (options.locale as Parameters<typeof loadStripe>[1] extends { locale?: infer L } ? L : never) ?? "auto",
    });

    if (!stripe) throw new Error("Failed to load Stripe.js");

    // Deferred-intent mode: Elements renders with real cart amount before PaymentIntent is created on submit
    const elements = stripe.elements({
      locale: (options.locale as any) ?? "auto",
      mode: "payment",
      amount: cartElement.cartInfo.amount,
      currency: cartElement.cartInfo.currency.toLowerCase(),
      capture_method: cartElement.captureMethod as "automatic" | "manual",
    });

    return {
      baseOptions: {
        processorUrl: options.processorUrl,
        sessionId: options.sessionId,
        locale: options.locale,
        stripe,
        elements,
        publishableKey: config.publishableKey,
        merchantReturnUrl: config.merchantReturnUrl,
        onComplete: options.onComplete ?? (() => {}),
        onError: options.onError ?? (() => {}),
      },
    };
  };

  async createDropinBuilder(
    type: DropinType,
  ): Promise<PaymentDropinBuilder | never> {
    const { baseOptions } = await this.setupData;

    if (type !== DropinType.embedded) {
      throw new Error(
        `Drop-in type not supported: ${type}. Supported: embedded`,
      );
    }

    return new StripeDropinEmbeddedBuilder(baseOptions);
  }

  async createComponentBuilder(
    _type: string,
  ): Promise<PaymentComponentBuilder | never> {
    throw new Error(
      "Use createDropinBuilder('embedded') for the Stripe Payment Element",
    );
  }

  async createStoredPaymentMethodBuilder(
    _type: string,
  ): Promise<StoredComponentBuilder | never> {
    throw new Error("Saved payment methods are not enabled for this connector");
  }

  async createExpressBuilder(
    _type: string,
  ): Promise<PaymentExpressBuilder | never> {
    throw new Error("Express checkout is not supported by this connector");
  }

  async isStoredPaymentMethodsEnabled(): Promise<boolean> {
    return false;
  }

  async getStoredPaymentMethods(_: {
    allowedMethodTypes: string[];
  }): Promise<{ storedPaymentMethods: [] }> {
    return { storedPaymentMethods: [] };
  }

  setStorePaymentDetails(_enabled: boolean): void {
    // no-op — saved cards disabled
  }
}
