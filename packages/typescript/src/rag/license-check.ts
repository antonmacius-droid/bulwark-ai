/**
 * License verification for BSL-licensed modules (RAG, compliance, admin panel).
 *
 * Supports two modes:
 *   1. Legacy: any truthy BULWARK_LICENSE_KEY suppresses the notice (backward compat)
 *   2. Signed key: HMAC-SHA256 verified offline using LICENSE_SIGNING_SECRET
 *
 * Does NOT block functionality — just logs a notice for unlicensed commercial use.
 */

import { createHmac } from 'crypto';

let noticeShown = false;

interface LicenseInfo {
  valid: boolean;
  product: string;
  plan: string;
  org: string;
  validUntil: string;
  expired: boolean;
}

function computeSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex').slice(0, 16);
}

function verifyLicenseKey(key: string, secret: string): LicenseInfo {
  const invalid: LicenseInfo = {
    valid: false,
    product: '',
    plan: '',
    org: '',
    validUntil: '',
    expired: false,
  };

  if (!key || !secret) return invalid;

  const parts = key.split('-');
  if (parts.length < 5) return invalid;

  const product = parts[0];
  const plan = parts[1];
  const signature = parts[parts.length - 1];
  const expiry = parts[parts.length - 2];
  const org = parts.slice(2, parts.length - 2).join('-');

  if (!product || !plan || !org || !expiry || !signature) return invalid;
  if (!/^\d{8}$/.test(expiry)) return invalid;

  const payload = `${product}-${plan}-${org}-${expiry}`;
  const expectedSignature = computeSignature(payload, secret);
  const valid = signature === expectedSignature;

  const year = expiry.slice(0, 4);
  const month = expiry.slice(4, 6);
  const day = expiry.slice(6, 8);
  const validUntil = `${year}-${month}-${day}`;
  const expiryDate = new Date(`${validUntil}T23:59:59Z`);
  const expired = expiryDate < new Date();

  return { valid, product: product.toLowerCase(), plan: plan.toLowerCase(), org, validUntil, expired };
}

export function checkLicense(module: string): void {
  if (noticeShown) return;

  // Skip in dev/test
  if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') return;

  const key = process.env.BULWARK_LICENSE_KEY ?? '';

  // Legacy mode: any truthy value suppresses the notice (backward compat)
  if (key && !key.startsWith('BULWARK-')) {
    return;
  }

  // Signed key mode: verify HMAC
  if (key.startsWith('BULWARK-')) {
    const secret = process.env.LICENSE_SIGNING_SECRET ?? '';
    const result = verifyLicenseKey(key, secret);

    if (result.valid && !result.expired) {
      return; // Licensed and not expired — suppress notice
    }

    if (result.valid && result.expired) {
      noticeShown = true;
      console.log(
        `\n  Bulwark AI - ${module} module license has expired (${result.validUntil}).\n` +
        `  Renew your license at https://afkzonagroup.lt/license\n` +
        `  Commercial production use requires a valid license.\n`,
      );
      return;
    }

    // Invalid signature — fall through to unlicensed notice
  }

  // No key or invalid key
  noticeShown = true;
  console.log(
    `\n  Bulwark AI - ${module} module is licensed under BSL 1.1.\n` +
    `  Free for development, testing, and non-commercial use.\n` +
    `  Commercial production use requires a license: https://afkzonagroup.lt/license\n` +
    `  Set BULWARK_LICENSE_KEY in your .env to suppress this notice.\n`,
  );
}
