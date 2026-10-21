import { defineConfig } from '@playwright/test';

// Chromium préinstallé (conteneur) ou celui de Playwright (Mac, Windows).
const executablePath = process.env.PW_CHROMIUM ?? undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'e2e/__artifacts__/results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5174',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      // Test en direct derrière un proxy sortant (conteneur de développement) :
      // E2E_PROXY=http://hôte:port. Le serveur local reste joint en direct.
      ...(process.env.E2E_PROXY
        ? { proxy: { server: process.env.E2E_PROXY, bypass: 'localhost,127.0.0.1' } } : {}),
    },
    // Un proxy qui inspecte le TLS présente son propre certificat.
    ignoreHTTPSErrors: !!process.env.E2E_PROXY,
  },
  webServer: process.env.E2E_BASE_URL ? undefined : [
    {
      // Passerelle de démonstration : jeu de données de la maquette, tests seulement.
      command: '../.venv/bin/python e2e/fake_gateway.py --port 8790',
      url: 'http://127.0.0.1:8790/api/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        VITE_DEFAULT_MODE: 'local',
        VITE_LOCAL_GATEWAY_URL: 'http://127.0.0.1:8790',
      },
    },
  ],
});
