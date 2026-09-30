import { expect, test } from '@playwright/test';

/**
 * A-14 : aucune page ne défile horizontalement à 360, 768, 1024 et 1440 px.
 * Les projets Playwright (playwright.config.ts) fixent les quatre largeurs.
 */
const PAGES = ['/login', '/admin/login', '/offline', '/install', '/page-inexistante'];

for (const path of PAGES) {
  test(`pas de défilement horizontal sur ${path}`, async ({ page }, testInfo) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `${path} @ ${testInfo.project.name}`).toBeLessThanOrEqual(clientWidth);
    await page.screenshot({
      path: testInfo.outputPath(`${path.replace(/\W/g, '_') || 'root'}.png`),
      fullPage: true,
    });
  });
}

test('la page de connexion propose téléphone et rôle', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Numéro de téléphone')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recevoir le code' })).toBeVisible();
});
