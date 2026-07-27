import { expect, test } from "@playwright/test"

const routes = ["/", "/about", "/tally", "/sprint-x", "/curalink", "/architectural-design"]

for (const route of routes) {
  test(`${route} renders without missing local resources`, async ({ page }) => {
    const failed = []
    page.on("response", response => {
      const url = new URL(response.url())
      if (url.hostname === "127.0.0.1" && response.status() >= 400) {
        failed.push(`${response.status()} ${url.pathname}`)
      }
    })

    await page.goto(route, { waitUntil: "domcontentloaded" })
    await expect(page).toHaveTitle("Dhwani Shah")
    await expect(page.locator("body")).toBeVisible()
    if (route === "/architectural-design") {
      await expect(page.locator("img").first()).toBeVisible()
    } else {
      expect((await page.locator("body").innerText()).trim().length).toBeGreaterThan(10)
    }
    await page.waitForTimeout(1_000)
    expect(failed).toEqual([])
  })
}

test("desktop navigation reaches About", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("link", { name: "About", exact: true }).first().click()
  await expect(page).toHaveURL(/\/about$/)
  await expect(page.getByText("YESTERDAY", { exact: true }).first()).toBeVisible()
})

test("mobile navigation opens and exposes its links", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await page.locator('[data-framer-name="open"]').first().click()
  await expect(page.getByRole("link", { name: "About", exact: true }).last()).toBeVisible()
  await expect(page.getByRole("link", { name: "Resume", exact: true }).last()).toBeVisible()
})
