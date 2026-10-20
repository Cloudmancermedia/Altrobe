// Whether the hosted prompt box shows, from the build's VITE_PROMPT_API and the page's query string
// (docs/hosted-prompt-box.md): unset, never; "preview", only at a URL with ?prompt=preview, so the box
// can be tried on the live site before anyone else sees it; "1", for everyone.
export function promptBoxOn(flag: string | undefined, search: string): boolean {
  if (flag === '1') return true
  return flag === 'preview' && new URLSearchParams(search).get('prompt') === 'preview'
}
