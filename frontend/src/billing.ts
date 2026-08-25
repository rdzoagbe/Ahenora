// Google Play Billing via RevenueCat — with a hard graceful-fallback rule:
// react-native-purchases is a NATIVE module, and OTA updates reach builds that
// don't contain it yet. Every entry point therefore no-ops cleanly (available:
// false) when the native side is missing, so this file is safe to ship OTA
// before the billing AAB exists.
//
// Store setup lives outside the code: products premium_monthly / premium_yearly
// in Play Console, linked in RevenueCat with entitlement "premium", and the
// public Android SDK key exposed as EXPO_PUBLIC_REVENUECAT_ANDROID_KEY.

import { Platform } from 'react-native';
import { logger } from './logger';

export type PurchaseCycle = 'monthly' | 'yearly';
// Which product the sheet should sell. Family is the default RevenueCat
// offering (offerings.current); Household is a separate offering that must be
// named "household" in the RevenueCat dashboard and hold the household:p1m /
// household:p1y packages. A missing Household offering fails soft (no_offering),
// so shipping this before the dashboard is set up never crashes a buyer.
export type PurchaseTier = 'family' | 'household';
const HOUSEHOLD_OFFERING_ID = 'household';

export interface BillingResult {
  ok: boolean;
  /** false when billing can't run here (no native module / no key / web). */
  available: boolean;
  /** true when the user now holds the premium entitlement. */
  premium?: boolean;
  /** user tapped back on the payment sheet — not an error. */
  cancelled?: boolean;
  error?: string;
}

const ENTITLEMENT_ID = 'premium';

// RevenueCat public Android SDK key (safe to embed — public by design, same
// pattern as the Google/Microsoft client IDs). The env override exists for
// forks/testing; the fallback keeps OTA bundles working even when the update
// pipeline doesn't inject env vars.
const FALLBACK_ANDROID_KEY = 'goog_wiMoDbBhcLrvPdUSRbZqXDhKkQi';

let configuredFor: string | null = null;

async function getPurchases(): Promise<any | null> {
  if (Platform.OS === 'web') return null;
  const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY?.trim() || FALLBACK_ANDROID_KEY;
  if (!apiKey) return null;
  try {
    const mod: any = await import('react-native-purchases');
    const Purchases = mod.default ?? mod;
    // Throws (or lacks natives) on builds that predate the billing AAB.
    if (typeof Purchases?.configure !== 'function') return null;
    return { Purchases, apiKey };
  } catch (e) {
    logger.warn('billing: native module unavailable', e);
    return null;
  }
}

/** Configure once per signed-in user; safe to call repeatedly. */
export async function initBilling(userId: string): Promise<boolean> {
  const loaded = await getPurchases();
  if (!loaded) return false;
  try {
    if (configuredFor !== userId) {
      loaded.Purchases.configure({ apiKey: loaded.apiKey, appUserID: userId });
      configuredFor = userId;
    }
    return true;
  } catch (e) {
    logger.warn('billing: configure failed', e);
    return false;
  }
}

function hasPremium(customerInfo: any): boolean {
  return Boolean(customerInfo?.entitlements?.active?.[ENTITLEMENT_ID]);
}

/**
 * Launch the Play payment sheet for the chosen cycle. Resolves with the
 * entitlement state; the caller then refreshes backend entitlements (the
 * RevenueCat webhook updates the family plan server-side in parallel).
 */
export async function purchasePremium(
  userId: string,
  cycle: PurchaseCycle,
  tier: PurchaseTier = 'family',
): Promise<BillingResult> {
  const loaded = await getPurchases();
  if (!loaded || !(await initBilling(userId))) return { ok: false, available: false };
  try {
    const offerings = await loaded.Purchases.getOfferings();
    // Family sells from the default offering; Household from its own named one.
    const offering = tier === 'household'
      ? (offerings?.all?.[HOUSEHOLD_OFFERING_ID] ?? null)
      : offerings?.current;
    if (!offering) return { ok: false, available: true, error: 'no_offering' };
    const pkg = cycle === 'yearly'
      ? offering.annual ?? offering.availablePackages?.find((p: any) => /year|annual/i.test(p?.product?.identifier || ''))
      : offering.monthly ?? offering.availablePackages?.find((p: any) => /month/i.test(p?.product?.identifier || ''));
    if (!pkg) return { ok: false, available: true, error: 'no_offering' };
    const { customerInfo } = await loaded.Purchases.purchasePackage(pkg);
    return { ok: true, available: true, premium: hasPremium(customerInfo) };
  } catch (e: any) {
    if (e?.userCancelled) return { ok: false, available: true, cancelled: true };
    logger.warn('billing: purchase failed', e);
    return { ok: false, available: true, error: e?.message || 'purchase_failed' };
  }
}

/** Restore purchases (e.g. reinstalled app / new device). */
export async function restorePurchases(userId: string): Promise<BillingResult> {
  const loaded = await getPurchases();
  if (!loaded || !(await initBilling(userId))) return { ok: false, available: false };
  try {
    const customerInfo = await loaded.Purchases.restorePurchases();
    return { ok: true, available: true, premium: hasPremium(customerInfo) };
  } catch (e: any) {
    logger.warn('billing: restore failed', e);
    return { ok: false, available: true, error: e?.message || 'restore_failed' };
  }
}
