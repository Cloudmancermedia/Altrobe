import { useEffect, useRef } from 'react'
import type { Features } from '../api/backend'
import { aboutLinks, copyrightLine, PROMPT_PRIVACY, SUPPORT } from './footer'

/** What the footer leaves out: what Altrobe is, support, links, credits and the legal notice. Opens only on click. */
export function AboutDialog({ open, onClose, features, hostedPrompt = false }: { open: boolean; onClose: () => void; features: Features; hostedPrompt?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    // Escape and the Close button both end in the dialog's close event. A click on the backdrop (the
    // dialog element itself, outside its content) closes it too.
    <dialog ref={ref} className="about" aria-labelledby="about-title" onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="about-body">
        <header className="about-head">
          <h2 id="about-title">About Altrobe</h2>
          <button type="button" className="about-close" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <p>A dressing room for World of Warcraft: Forever. Dress any race in any gear, give the character a name, guild and title, and share the look as a link.</p>
        {hostedPrompt && <p className="small">{PROMPT_PRIVACY}</p>}
        <section className="about-support">
          <p>Altrobe is free to use. If it's useful to you, you can help keep it running.</p>
          <a className="support-button" href={SUPPORT.href} target="_blank" rel="noreferrer">{SUPPORT.label}</a>
        </section>
        <ul className="about-links">
          {aboutLinks(features).map((l) => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noreferrer">{l.label}</a>
              {l.note && <span className="muted small"> {l.note}</span>}
            </li>
          ))}
        </ul>
        <p className="muted small">
          {copyrightLine()}. Altrobe is a fan project. It is not affiliated with or endorsed by Blizzard Entertainment.
          World of Warcraft is a trademark of Blizzard Entertainment, Inc.
        </p>
      </div>
    </dialog>
  )
}
