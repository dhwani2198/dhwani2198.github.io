import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, extname, join } from "node:path"
import { fileURLToPath } from "node:url"

// Framer's canonical deployment host is more reliable for repeated asset refreshes
// than the custom preview alias, while serving the exact same published build.
const source = "https://voluntary-department-447105.framer.app"
const routes = ["/", "/about", "/tally", "/sprint-x", "/curalink", "/architectural-design"]
const siteRoot = fileURLToPath(new URL("../site/", import.meta.url))
const allowedHosts = new Set(["framerusercontent.com", "fonts.gstatic.com"])
const failures = []
const downloaded = new Set()
const queued = new Set()
const queue = []

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function fetchWithRetry(url, attempts = 4) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; local-portfolio-mirror/1.0)" }
      })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return response
    } catch (error) {
      lastError = error
      if (attempt < attempts) await sleep(attempt * 500)
    }
  }
  throw lastError
}

function cleanUrl(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("\\u0026", "&")
    .replace(/[;,]+$/, "")
}

function extractRemoteUrls(text) {
  const extensions = "json|mjs|js|css|svg|png|jpe?g|webp|gif|avif|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|otf"
  const pattern = new RegExp(
    `https:\\/\\/(?:framerusercontent\\.com|fonts\\.gstatic\\.com)\\/[^\\s\"'<>\\x60(),;]+?\\.(?:${extensions})(?:\\?[^\\s\"'<>\\x60(),;]*)?`,
    "gi"
  )
  const matches = text.match(pattern) || []
  return matches.map(cleanUrl)
}

function outputPath(url) {
  const parsed = new URL(url)
  const prefix = parsed.hostname === "framerusercontent.com"
    ? "assets"
    : join("external", parsed.hostname)
  return join(siteRoot, prefix, decodeURIComponent(parsed.pathname))
}

function publicUrlPrefix(hostname) {
  return hostname === "framerusercontent.com" ? "/assets" : `/external/${hostname}`
}

function localize(text) {
  return text
    .replaceAll("https://framerusercontent.com", "/assets")
    .replaceAll("https://fonts.gstatic.com", "/external/fonts.gstatic.com")
    .replaceAll("https://voluntary-department-447105.framer.app", "")
    .replaceAll("https://dhwani.framer.ai", "")
}

function enqueue(value, base) {
  let parsed
  try {
    parsed = new URL(cleanUrl(value), base)
  } catch {
    return
  }
  if (!allowedHosts.has(parsed.hostname)) return
  if (parsed.pathname === "/") return
  parsed.hash = ""
  const original = parsed.href
  parsed.search = ""
  const key = parsed.href
  if (queued.has(key)) return
  queued.add(key)
  queue.push({ url: key, fallback: original })
}

function discover(text, base) {
  for (const value of extractRemoteUrls(text)) enqueue(value, base)

  if (base.endsWith(".mjs")) {
    const importMatches = text.matchAll(/["'](\.{1,2}\/[^"']+\.mjs(?:\?[^"']*)?)["']/g)
    for (const match of importMatches) enqueue(match[1], base)
  }
}

async function downloadAsset(item) {
  if (downloaded.has(item.url)) return
  const file = outputPath(item.url)
  await mkdir(dirname(file), { recursive: true })

  let response
  try {
    response = await fetchWithRetry(item.url)
  } catch (primaryError) {
    if (item.fallback === item.url) throw primaryError
    response = await fetchWithRetry(item.fallback)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  let body = buffer
  const extension = extname(new URL(item.url).pathname).toLowerCase()

  if ([".mjs", ".js", ".css", ".json", ".svg"].includes(extension)) {
    const text = buffer.toString("utf8")
    discover(text, item.url)
    body = Buffer.from(localize(text))
  }

  await writeFile(file, body)
  downloaded.add(item.url)
}

async function drainQueue(concurrency = 8) {
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const item = queue.shift()
      if (!item) return
      try {
        await downloadAsset(item)
      } catch (error) {
        failures.push({ url: item.url, error: String(error) })
        console.warn(`Failed: ${item.url} (${error})`)
      }
    }
  })
  await Promise.all(workers)
  if (queue.length) await drainQueue(concurrency)
}

// `site/` is generated output. Rebuilding from a clean directory prevents stale
// files from older Framer deployments or parser versions being shipped.
await rm(siteRoot, { recursive: true, force: true })
await mkdir(siteRoot, { recursive: true })

for (const route of routes) {
  const pageUrl = new URL(route, source).href
  const response = await fetchWithRetry(pageUrl)
  const html = await response.text()
  discover(html, pageUrl)

  const output = route === "/"
    ? join(siteRoot, "index.html")
    : join(siteRoot, route.slice(1), "index.html")
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, localize(html))
  console.log(`Page: ${route}`)
}

for (const path of ["/sitemap.xml", "/robots.txt"]) {
  const response = await fetchWithRetry(new URL(path, source))
  await writeFile(join(siteRoot, path.slice(1)), localize(await response.text()))
}

await drainQueue()

const manifest = {
  source,
  mirroredAt: new Date().toISOString(),
  routes,
  assetCount: downloaded.size,
  failures
}
await writeFile(join(siteRoot, "mirror-manifest.json"), JSON.stringify(manifest, null, 2) + "\n")

console.log(`Assets: ${downloaded.size}`)
console.log(`Failures: ${failures.length}`)
if (failures.length) process.exitCode = 1
