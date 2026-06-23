import Stripe from 'stripe';
import { getConfig } from '../config/config';

let _stripe: Stripe | undefined;

export const getStripeClient = (): Stripe => {
  if (!_stripe) {
    _stripe = new Stripe(getConfig().stripeSecretKey, { apiVersion: '2026-05-27.dahlia' });
  }
  return _stripe;
};
