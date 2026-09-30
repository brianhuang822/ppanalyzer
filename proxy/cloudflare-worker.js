/**
 * Optional read-only CORS proxy for live player lookups.
 *
 * BeatLeader's API only sends CORS headers to its own sites, so the browser can't read it from
 * GitHub Pages; the app then falls back to the snapshot. Deploying this worker (free tier is
 * plenty) and building the site with
 *   VITE_SCORESABER_API=https://<worker>.workers.dev/scoresaber
 *   VITE_BEATLEADER_API=https://<worker>.workers.dev/beatleader
 * makes lookups live for every player, not just those in the snapshot.
 *
 * Only GET requests to the specific player endpoints the app uses are forwarded.
 */

const UPSTREAMS = {
  scoresaber: 'https://scoresaber.com/api/v2',
  beatleader: 'https://api.beatleader.com',
}

// Paths (after the upstream prefix) the app needs; anything else is refused.
const ALLOWED = [/^\/players\/?$/, /^\/players\/[\w-]+\/?$/, /^\/players\/[\w-]+\/scores\/?$/, /^\/player\/[\w-]+\/?$/,
  /^\/player\/[\w-]+\/scores\/?$/]

// Lock this down to your site, e.g. ['https://brianhuang822.github.io'].
const ALLOWED_ORIGINS = ['https://brianhuang822.github.io', 'http://localhost:5173', 'http://localhost:4173']

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') ?? ''
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) })
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors(origin) })

    const url = new URL(request.url)
    const [, name, ...rest] = url.pathname.split('/')
    const upstream = UPSTREAMS[name]
    const path = `/${rest.join('/')}`
    if (!upstream || !ALLOWED.some((re) => re.test(path))) {
      return new Response('Not found', { status: 404, headers: cors(origin) })
    }

    const response = await fetch(`${upstream}${path}${url.search}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'ppanalyzer-proxy (+https://github.com/brianhuang822/ppanalyzer)' },
      cf: { cacheTtl: 60, cacheEverything: true },
    })
    const headers = new Headers(cors(origin))
    headers.set('Content-Type', response.headers.get('Content-Type') ?? 'application/json')
    headers.set('Cache-Control', 'public, max-age=60')
    return new Response(response.body, { status: response.status, headers })
  },
}
