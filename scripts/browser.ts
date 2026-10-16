import { existsSync } from 'node:fs';

export async function launchChromium() {
  const pw: any = await import('playwright-core');
  const candidates = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean) as string[];
  const executablePath = candidates.find((p) => existsSync(p));
  return pw.chromium.launch({ executablePath, args: ['--no-sandbox'] });
}
