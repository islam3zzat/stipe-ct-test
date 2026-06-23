function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}

export const readConfiguration = () => ({
  // commercetools
  projectKey: required('CTP_PROJECT_KEY'),
  clientId: required('CTP_CLIENT_ID'),
  clientSecret: required('CTP_CLIENT_SECRET'),
  authUrl: optional('CTP_AUTH_URL', 'https://auth.europe-west1.gcp.commercetools.com')!,
  apiUrl: optional('CTP_API_URL', 'https://api.europe-west1.gcp.commercetools.com')!,
  sessionUrl: optional('CTP_SESSION_URL', 'https://session.europe-west1.gcp.commercetools.com')!,
  checkoutUrl: optional('CTP_CHECKOUT_URL', 'https://checkout.europe-west1.gcp.commercetools.com')!,
  jwksUrl: optional('CTP_JWKS_URL', 'https://mc-api.europe-west1.gcp.commercetools.com/.well-known/jwks.json')!,
  jwtIssuer: optional('CTP_JWT_ISSUER', 'https://mc-api.europe-west1.gcp.commercetools.com')!,

  // Stripe
  stripeSecretKey: required('STRIPE_SECRET_KEY'),
  stripeWebhookSigningSecret: required('STRIPE_WEBHOOK_SIGNING_SECRET'),
  stripePublishableKey: required('STRIPE_PUBLISHABLE_KEY'),
  stripeWebhookId: optional('STRIPE_WEBHOOK_ID'),
  stripeCaptureMethod: (optional('STRIPE_CAPTURE_METHOD', 'manual') as 'automatic' | 'manual'),
  stripeCollectBillingAddress: (optional('STRIPE_COLLECT_BILLING_ADDRESS', 'auto') as 'auto' | 'never' | 'if_required'),
  merchantReturnUrl: required('MERCHANT_RETURN_URL'),
  allowedOrigins: optional('ALLOWED_ORIGINS', '')!.split(',').filter(Boolean),
  paymentInterface: optional('PAYMENT_INTERFACE', 'checkout-stripe')!,

  // server
  healthCheckTimeout: parseInt(optional('HEALTH_CHECK_TIMEOUT', '5000')!),
  loggerLevel: optional('LOGGER_LEVEL', 'info')!,
});

let _config: ReturnType<typeof readConfiguration> | undefined;

export const getConfig = (): ReturnType<typeof readConfiguration> => {
  if (!_config) _config = readConfiguration();
  return _config;
};

// Legacy alias used by payment-sdk bootstrap
export const config = {
  get projectKey() { return getConfig().projectKey; },
  get clientId() { return getConfig().clientId; },
  get clientSecret() { return getConfig().clientSecret; },
  get authUrl() { return getConfig().authUrl; },
  get apiUrl() { return getConfig().apiUrl; },
  get sessionUrl() { return getConfig().sessionUrl; },
  get checkoutUrl() { return getConfig().checkoutUrl; },
  get jwksUrl() { return getConfig().jwksUrl; },
  get jwtIssuer() { return getConfig().jwtIssuer; },
  get healthCheckTimeout() { return getConfig().healthCheckTimeout; },
  get loggerLevel() { return getConfig().loggerLevel; },
};
