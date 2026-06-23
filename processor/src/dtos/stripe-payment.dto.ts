import { Static, Type } from '@sinclair/typebox';

export const StripeCreatePaymentResponseSchema = Type.Object({
  clientSecret: Type.String(),
  paymentReference: Type.String(),
});

export const StripeConfigElementResponseSchema = Type.Object({
  cartInfo: Type.Object({
    amount: Type.Number(),
    currency: Type.String(),
  }),
  captureMethod: Type.String(),
  collectBillingAddress: Type.String(),
  layout: Type.String(),
  appearance: Type.Optional(Type.String()),
});

export type StripeCreatePaymentResponseSchemaDTO = Static<typeof StripeCreatePaymentResponseSchema>;
export type StripeConfigElementResponseSchemaDTO = Static<typeof StripeConfigElementResponseSchema>;
