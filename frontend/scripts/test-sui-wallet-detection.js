#!/usr/bin/env node
/**
 * Verifies that the Sui wallet detector flips on ANY of the dozen-or-so
 * Sui wallet extensions currently shipping, NOT just one specific
 * wallet. The pilot installed Suiet and the previous detector (which
 * only probed window.suiWallet) showed "Not installed" — bug.
 *
 * The detector is a copy of `detectAnySuiWallet()` in WalletContext.
 * They MUST stay in lockstep. If you change WalletContext, mirror
 * here.
 */
const SUI_WALLET_PROBES = [
  "suiWallet", "suiet", "martian",
  "ethos", "ethosWallet", "nightly",
  "surfWallet", "fewcha", "glassWallet",
  "trustWallet", "bistowWallet",
  "abcWallet", "slushWallet",
  "backpack", "backpackWallet",
  "okxwallet",
  "sui",
];

function detectAnySuiWallet(mockWindow) {
  for (const key of SUI_WALLET_PROBES) {
    const api = mockWindow[key];
    if (!api) continue;
    if (
      typeof api === "object" &&
      (typeof api.requestPermissions === "function" ||
        typeof api.connect === "function" ||
        typeof api.hasPermissions === "function")
    ) {
      return { key, api };
    }
  }
  return null;
}

const tests = [
  { name: "Suiet installed",          mock: { suiet: { requestPermissions: () => {} } } },
  { name: "Martian installed",        mock: { martian: { connect: () => {} } } },
  { name: "Ethos installed",          mock: { ethos: { hasPermissions: () => {} } } },
  { name: "Nightly installed",        mock: { nightly: { requestPermissions: () => {} } } },
  { name: "Surf installed",           mock: { surfWallet: { requestPermissions: () => {} } } },
  { name: "Fewcha installed",         mock: { fewcha: { requestPermissions: () => {} } } },
  { name: "Glass installed",          mock: { glassWallet: { connect: () => {} } } },
  { name: "Trust installed",          mock: { trustWallet: { requestPermissions: () => {} } } },
  { name: "ABC installed",            mock: { abcWallet: { requestPermissions: () => {} } } },
  { name: "Slush installed",          mock: { slushWallet: { connect: () => {} } } },
  { name: "Backpack installed",       mock: { backpack: { requestPermissions: () => {} } } },
  { name: "Backpack (alt key)",       mock: { backpackWallet: { connect: () => {} } } },
  { name: "OKX Wallet installed",     mock: { okxwallet: { requestPermissions: () => {} } } },
  { name: "Sui Wallet (official)",    mock: { suiWallet: { requestPermissions: () => {} } } },
  { name: "Legacy 'sui' injection",   mock: { sui:      { requestPermissions: () => {} } } },
  // Negative cases
  { name: "No Sui extension",         mock: {} },
  { name: "Stub object (no methods)", mock: { suiWallet: {} } },
  { name: "Non-object injection",     mock: { suiWallet: "not an object" } },
];

let fail = 0;
for (const { name, mock } of tests) {
  const expectedOk = name !== "No Sui extension" &&
                     name !== "Stub object (no methods)" &&
                     name !== "Non-object injection";
  const result = detectAnySuiWallet(mock);
  const got = result ? result.key : null;
  const gotOk = !!result;
  if (gotOk === expectedOk) {
    console.log(`PASS  ${name.padEnd(35)} → ${got || "(null)"}`);
  } else {
    console.error(`FAIL  ${name.padEnd(35)}`);
    console.error(`        got      = ${got}`);
    console.error(`        expected = ${expectedOk ? "<wallet>" : "(null)"}`);
    fail++;
  }
}

if (fail > 0) {
  console.error(`\n${fail} test(s) failed.`);
  process.exit(1);
}
console.log(`\nALL ${tests.length} CASES PASSED ✓`);
console.log("Any of ~12 Sui wallet extensions is detected — no longer");
console.log("restricted to the official 'suiWallet' injection.");
