import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const siteRoot = fileURLToPath(new URL("../site/", import.meta.url))
const routes = ["/", "/about", "/tally", "/sprint-x", "/curalink", "/architectural-design"]
const manifest = JSON.parse(await readFile(`${siteRoot}/mirror-manifest.json`, "utf8"))

for (const route of routes) {
  const file = route === "/" ? `${siteRoot}/index.html` : `${siteRoot}${route}/index.html`
  const html = await readFile(file, "utf8")
  if (!html.includes("Dhwani Shah")) throw new Error(`${route}: missing page title/content`)
  if (html.includes("https://framerusercontent.com")) throw new Error(`${route}: contains a remote Framer asset`)
  if (html.includes("https://fonts.gstatic.com")) throw new Error(`${route}: contains a remote Google font`)
}

if (manifest.failures.length) throw new Error(`${manifest.failures.length} asset downloads failed`)
console.log(`Validated ${routes.length} routes and ${manifest.assetCount} localized assets.`)
