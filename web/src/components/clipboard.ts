/**
 * Puts text on the clipboard. Without the clipboard API (a plain http page, an older browser) or when
 * it refuses, selects the text in its box and copies the selection instead. True when either worked.
 */
export async function copyText(text: string, select: () => void): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    select()
    try { return document.execCommand('copy') } catch { return false }
  }
}
