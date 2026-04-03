/**
 * Soft license reminder for BSL-licensed modules.
 * Does NOT block functionality — just logs a notice.
 */

let noticeShown = false;

export function checkLicense(module: string): void {
  if (noticeShown) return;
  if (process.env.BULWARK_LICENSE_KEY) return;
  if (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") return;

  noticeShown = true;
  console.log(
    `\n  Bulwark AI - ${module} module is licensed under BSL 1.1.\n` +
    `  Free for development, testing, and non-commercial use.\n` +
    `  Commercial production use requires a license: info@afkzonagroup.lt\n` +
    `  Set BULWARK_LICENSE_KEY to suppress this notice.\n`
  );
}
