// Set the minimum required env vars so the fail-fast config validation passes during tests.
process.env.CTP_PROJECT_KEY = 'test-project';
process.env.CTP_CLIENT_ID = 'test-client-id';
process.env.CTP_CLIENT_SECRET = 'test-client-secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
process.env.STRIPE_WEBHOOK_SIGNING_SECRET = 'whsec_placeholder';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_placeholder';
process.env.MERCHANT_RETURN_URL = 'https://test.example.com/payment-complete';
process.env.ALLOWED_ORIGINS = 'https://test.example.com';
