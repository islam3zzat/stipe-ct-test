import { Static, Type } from '@sinclair/typebox';

export const StripeCreatePaymentResponseSchema = Type.Object({
  clientSecret: Type.String(),
  paymentReference: Type.String(),
});

export type StripeCreatePaymentResponseSchemaDTO = Static<typeof StripeCreatePaymentResponseSchema>;
