const repository = 'liukun2634/agent-pulse'
const status = document.querySelector('[data-release-status]')

function safeDownload(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname.startsWith(`/${repository}/releases/download/`)
      ? url.href
      : null
  } catch {
    return null
  }
}

function enableAsset(kind, asset) {
  const link = document.querySelector(`[data-asset="${kind}"]`)
  const url = asset && safeDownload(asset.browser_download_url)
  if (!link || !url) return
  link.href = url
  link.removeAttribute('aria-disabled')
  link.removeAttribute('tabindex')
}

async function loadRelease() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/releases?per_page=10`,
      { signal: controller.signal, headers: { Accept: 'application/vnd.github+json' } },
    )
    if (response.status === 404) {
      status.textContent =
        'No Windows installer has been published yet. Check GitHub Releases for future versions.'
      return
    }
    if (!response.ok) throw new Error('Release lookup failed')
    const releases = await response.json()
    if (!Array.isArray(releases)) throw new Error('Invalid release list')
    const release = releases.find(
      (item) =>
        !item.draft &&
        Array.isArray(item.assets) &&
        item.assets.some(
          (asset) =>
            /^Agent-Pulse-Setup-.+-x64\.exe$/.test(asset.name) &&
            safeDownload(asset.browser_download_url),
        ),
    )
    if (!release) {
      status.textContent =
        'No Windows installer has been published yet. Check GitHub Releases for future versions.'
      return
    }
    const installer = release.assets.find(
      (asset) =>
        /^Agent-Pulse-Setup-.+-x64\.exe$/.test(asset.name) &&
        safeDownload(asset.browser_download_url),
    )
    enableAsset('installer', installer)
    enableAsset(
      'companion',
      release.assets.find((asset) => asset.name === 'pulse-companion.vsix'),
    )
    enableAsset(
      'checksums',
      release.assets.find((asset) => asset.name === 'SHA256SUMS.txt'),
    )
    document.querySelector('[data-release-name]').textContent =
      release.tag_name || release.name || 'GitHub Release'
    const published = new Date(release.published_at)
    document.querySelector('[data-release-date]').textContent = Number.isFinite(published.getTime())
      ? published.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        })
      : '-'
    document.querySelector('[data-release-size]').textContent = Number.isFinite(installer.size)
      ? `${(installer.size / 1024 / 1024).toFixed(1)} MB · x64`
      : 'Windows x64'
    document.querySelector('[data-release-notes]').href =
      `https://github.com/${repository}/releases/tag/${encodeURIComponent(release.tag_name)}`
    status.textContent = release.prerelease
      ? 'This is a prerelease for testing and feedback. Compatibility has not been verified in every environment.'
      : 'A release is available. Review the support details and installation notes below before installing.'
  } catch {
    status.textContent =
      'Unable to check releases right now. Visit GitHub Releases to browse downloads.'
  } finally {
    clearTimeout(timeout)
  }
}

void loadRelease()
