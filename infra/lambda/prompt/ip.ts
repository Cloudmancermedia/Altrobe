import { isIP } from 'node:net'

/**
 * The viewer's IP address. CloudFront sends `CloudFront-Viewer-Address` as `ip:port`, and an IPv6
 * address keeps its colons, so the port is whatever follows the last one. Without a usable header
 * (only possible when a request skips CloudFront, which the handler refuses anyway) it falls back to
 * the address API Gateway saw.
 */
export function viewerIp(headers: Record<string, string | undefined>, sourceIp?: string): string | undefined {
  const value = headers['cloudfront-viewer-address']?.trim()
  if (value) {
    const colon = value.lastIndexOf(':')
    const port = value.slice(colon + 1)
    const host = value.slice(0, colon).replace(/^\[(.*)\]$/, '$1')
    if (colon > 0 && /^\d{1,5}$/.test(port) && isIP(host)) return host
  }
  return sourceIp && isIP(sourceIp) ? sourceIp : undefined
}

/**
 * What the per-IP limit counts by: an IPv4 address, or an IPv6 address's /64. One home or phone
 * gets a whole /64 and can rotate addresses inside it freely.
 */
export function rateKey(ip: string): string {
  if (isIP(ip) === 4) return ip
  const groups = ipv6Groups(ip)
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff)
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.')
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`
}

function ipv6Groups(ip: string): number[] {
  let s = ip.toLowerCase().split('%')[0]
  const v4 = s.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [a, b, c, d] = v4.slice(2).map(Number)
    s = `${v4[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head, tail] = s.split('::')
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const groups = s.includes('::') ? [...h, ...Array<string>(8 - h.length - t.length).fill('0'), ...t] : h
  return groups.map((g) => parseInt(g, 16))
}
