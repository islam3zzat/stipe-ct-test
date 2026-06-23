import * as dotenv from 'dotenv';
dotenv.config();

import Stripe from 'stripe';
import { log } from '../libs/logger';

async function validateStripeCredentials(): Promise<void> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    process.stderr.write('STRIPE_SECRET_KEY is not set — connector deployed but Stripe calls will fail\n');
    return;
  }

  try {
    const stripe = new Stripe(secretKey, { apiVersion: '2026-05-27.dahlia' });
    await stripe.paymentMethodConfigurations.list({ limit: 1 });
    log.info('Stripe credentials validated successfully');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`WARNING: Stripe credentials validation failed: ${msg}\n`);
    // warn-and-continue — let the deploy succeed so config can be corrected without a redeploy
  }
}

async function postDeploy(): Promise<void> {
  await validateStripeCredentials();
}

async function run() {
  try {
    await postDeploy();
  } catch (error) {
    if (error instanceof Error) {
      process.stderr.write(`Post-deploy failed: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}

run();
