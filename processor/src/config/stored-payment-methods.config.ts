// Saved payment methods (stored cards) are disabled for this connector.
// This stub keeps any template imports that reference this module compiling.

export type StoredPaymentMethodsConfig = {
  enabled: boolean;
  config: {
    paymentInterface: string;
    interfaceAccount?: string;
    allowedPaymentMethods: string[];
  };
};

export const getStoredPaymentMethodsConfig = (): StoredPaymentMethodsConfig => ({
  enabled: false,
  config: {
    paymentInterface: 'checkout-stripe',
    interfaceAccount: undefined,
    allowedPaymentMethods: [],
  },
});
