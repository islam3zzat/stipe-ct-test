import { Stripe, StripeElements, StripePaymentElement } from "@stripe/stripe-js";
import {
  DropinComponent,
  DropinOptions,
  PaymentDropinBuilder,
} from "../payment-enabler/payment-enabler";
import { StripeBaseOptions } from "../payment-enabler/stripe-payment-enabler";

export class StripeDropinEmbeddedBuilder implements PaymentDropinBuilder {
  public dropinHasSubmit = true;

  constructor(private baseOptions: StripeBaseOptions) {}

  build(config: DropinOptions): DropinComponent {
    return new StripeDropinComponent(this.baseOptions, config);
  }
}

export class StripeDropinComponent implements DropinComponent {
  private stripe: Stripe;
  private elements: StripeElements;
  private paymentElement: StripePaymentElement | null = null;
  private mountedSelector: string | null = null;
  private paymentReference: string | null = null;
  private errorEl: HTMLElement | null = null;

  constructor(
    private baseOptions: StripeBaseOptions,
    private dropinOptions: DropinOptions,
  ) {
    this.stripe = baseOptions.stripe;
    this.elements = baseOptions.elements;
  }

  async mount(selector: string): Promise<void> {
    this.mountedSelector = selector;

    const container = document.querySelector(selector);
    if (!container) throw new Error(`Mount target not found: ${selector}`);

    // Inline error element shown for card_error / validation_error
    this.errorEl = document.createElement("div");
    this.errorEl.setAttribute("role", "alert");
    this.errorEl.style.cssText = "color:#df1b41;font-size:0.875rem;margin-top:0.5rem;min-height:1.25rem";
    container.appendChild(this.errorEl);

    this.paymentElement = this.elements.create("payment", {
      layout: "tabs",
    });

    this.paymentElement.mount(selector);

    // Clear inline error when the user edits their card details
    this.paymentElement.on("change", () => this.showInlineError(""));

    // Signal ready once the Payment Element has fully loaded
    this.paymentElement.on("ready", () => {
      this.dropinOptions.onDropinReady?.();
    });
  }

  private showInlineError(message: string): void {
    if (this.errorEl) this.errorEl.textContent = message;
  }

  async submit(): Promise<void> {
    if (!this.mountedSelector) {
      throw new Error("Drop-in has not been mounted yet");
    }

    try {
      // 1. Trigger client-side validation — shows field errors without submitting
      const { error: submitError } = await this.elements.submit();
      if (submitError) {
        // validation_error from elements.submit() means the user left a field empty/invalid
        if (submitError.type === "validation_error") {
          this.showInlineError(submitError.message ?? "Please complete your payment details.");
          return;
        }
        this.baseOptions.onError(submitError);
        return;
      }

      // 2. Call the processor to create the Stripe PaymentIntent + CT Payment
      const createRes = await fetch(
        `${this.baseOptions.processorUrl}/payments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Session-Id": this.baseOptions.sessionId,
          },
          body: "{}",
        },
      );

      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({}));
        throw new Error(
          body.message ?? `POST /payments failed: ${createRes.status}`,
        );
      }

      const { clientSecret, paymentReference }: {
        clientSecret: string;
        paymentReference: string;
      } = await createRes.json();

      this.paymentReference = paymentReference;

      // 3. Confirm the PaymentIntent on the Stripe side
      //    Stripe handles 3DS/redirect automatically; on success it either
      //    stays on page (card) or redirects to MERCHANT_RETURN_URL.
      const { error: confirmError } = await this.stripe.confirmPayment({
        elements: this.elements,
        clientSecret,
        confirmParams: {
          return_url: this.baseOptions.merchantReturnUrl,
        },
        // redirect: 'if_required' keeps card payments on-page;
        // methods that need a redirect will navigate automatically.
        redirect: "if_required",
      });

      if (confirmError) {
        // User-recoverable errors (wrong card number, declined, etc.) are shown
        // inline near the payment form — the user can correct and resubmit without
        // the storefront needing to intervene.
        if (
          confirmError.type === "card_error" ||
          confirmError.type === "validation_error"
        ) {
          this.showInlineError(confirmError.message ?? "Payment failed. Please check your card details.");
          return;
        }
        // Non-recoverable errors (config mismatch, Stripe outage) bubble to the storefront.
        this.baseOptions.onError(confirmError, { paymentReference });
        return;
      }

      // Payment confirmed on-page (no redirect needed) — notify the storefront
      this.baseOptions.onComplete({
        isSuccess: true,
        paymentReference,
      });
    } catch (err) {
      this.baseOptions.onError(err, {
        paymentReference: this.paymentReference ?? undefined,
      });
    }
  }
}
