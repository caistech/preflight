#!/usr/bin/env node
/**
 * Auth smoke-test — verifies the four critical auth surfaces respond.
 *
 * Per the global AUTH SMOKE-TEST ON EVERY MEMORY SAVE rule, this script
 * should run after any change that touches auth chrome. It only verifies
 * routes are alive — full end-to-end (real signup, real email delivery,
 * real reset) needs a manual pass through the UI.
 *
 * Usage:
 *   node scripts/auth-smoke.mjs                 # against PUBLIC_APP_URL
 *   node scripts/auth-smoke.mjs https://...     # against an explicit URL
 *
 * Exit code: 0 if everything's 2xx/3xx, 1 if any route is dead.
 */

const PUBLIC_APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.VERCEL_URL ||
  process.argv[2] ||
  'https://preflight-phi.vercel.app';

const ROUTES = [
  { path: '/', expect: [200, 302], name: 'Landing' },
  { path: '/login', expect: [200], name: 'Login page' },
  { path: '/forgot-password', expect: [200], name: 'Forgot-password page' },
  { path: '/reset-password', expect: [200], name: 'Reset-password page' },
  // /api/auth/callback is a redirect target; expect a 3xx or a JSON error
  // for a missing code, both signal the handler is alive.
  { path: '/api/auth/callback', expect: [301, 302, 303, 307, 400, 401], name: 'Auth callback' },
];

const base = PUBLIC_APP_URL.replace(/\/$/, '');
console.log(`Smoke-testing ${base}\n`);

let failed = 0;
for (const r of ROUTES) {
  try {
    const res = await fetch(`${base}${r.path}`, { redirect: 'manual' });
    const ok = r.expect.includes(res.status);
    const marker = ok ? '✓' : '✗';
    console.log(`  ${marker} ${r.path.padEnd(20)} ${res.status}  ${r.name}`);
    if (!ok) failed++;
  } catch (e) {
    console.log(`  ✗ ${r.path.padEnd(20)} ERROR ${e.message}`);
    failed++;
  }
}

console.log('');
if (failed === 0) {
  console.log('OK — all auth surfaces respond. Manual e2e (real signup, magic link, password reset) still required for full coverage.');
  process.exit(0);
} else {
  console.log(`FAILED — ${failed} route(s) returned an unexpected status. Inspect deploy.`);
  process.exit(1);
}
