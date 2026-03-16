import { useState, useRef, useEffect, useCallback } from 'react'
import axios from 'axios'
import './App.css'

const API = 'http://localhost:8000'

// ─── Escape HTML special chars ───────────────────────────────────────────────
function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ─── Build highlighted HTML from plain text + errors ─────────────────────────
function buildHighlightedHTML(text, errors) {
  if (!text) return ''
  if (!errors || errors.length === 0) {
    return escHtml(text).replace(/\n/g, '<br/>')
  }

  const sorted = [...errors].sort((a, b) => a.start - b.start)
  let html = ''
  let pos = 0

  for (const err of sorted) {
    if (err.start < pos) continue
    // Plain text before this error
    const before = text.slice(pos, err.start)
    html += escHtml(before).replace(/\n/g, '<br/>')
    // Error span
    const cls =
      err.type === 'spelling'   ? 'err-spell'   :
      err.type === 'grammar'    ? 'err-grammar'  :
                                  'err-context'
    const word = text.slice(err.start, err.end)
    const tooltip = escHtml(err.message)
    const suggs   = escHtml((err.suggestions || []).join(', '))
    html += `<span class="${cls}" data-msg="${tooltip}" data-sugg="${suggs}" data-start="${err.start}" data-end="${err.end}">${escHtml(word)}</span>`
    pos = err.end
  }
  // Remaining plain text
  html += escHtml(text.slice(pos)).replace(/\n/g, '<br/>')
  return html
}

// ─── Save & restore caret as char offset ─────────────────────────────────────
function getCaretCharOffset(el) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0)
  const preRange = range.cloneRange()
  preRange.selectNodeContents(el)
  preRange.setEnd(range.endContainer, range.endOffset)
  return preRange.toString().length
}

function setCaretCharOffset(el, offset) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null)
  let remaining = offset
  let node
  while ((node = walker.nextNode())) {
    if (remaining <= node.textContent.length) {
      const range = document.createRange()
      range.setStart(node, remaining)
      range.collapse(true)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      return
    }
    remaining -= node.textContent.length
  }
  // fallback: move to end
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  window.getSelection().removeAllRanges()
  window.getSelection().addRange(range)
}

// ─── Tooltip component ───────────────────────────────────────────────────────
function Tooltip({ x, y, message, suggestions, type, onClose }) {
  const colors = {
    spelling:   { bg: '#fff5f5', border: '#e53e3e', label: '🔴 Spelling Error',   color: '#c53030' },
    grammar:    { bg: '#ebf8ff', border: '#3182ce', label: '🔵 Grammar Error',    color: '#2b6cb0' },
    contextual: { bg: '#f0fff4', border: '#38a169', label: '🟢 Contextual Hint',  color: '#276749' },
  }
  const c = colors[type] || colors.spelling
  const suggs = suggestions ? suggestions.filter(Boolean) : []

  return (
    <div
      className="tooltip-popup"
      style={{ left: x, top: y, borderColor: c.border, background: c.bg }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="tooltip-label" style={{ color: c.color }}>{c.label}</div>
      <p className="tooltip-msg">{message}</p>
      {suggs.length > 0 && (
        <div className="tooltip-suggs">
          <span className="sugg-label">Suggestions:</span>
          {suggs.map((s, i) => (
            <span key={i} className="sugg-chip" style={{ borderColor: c.border, color: c.color }}>{s}</span>
          ))}
        </div>
      )}
      <button className="tooltip-close" onClick={onClose}>✕</button>
    </div>
  )
}

// ─── Sidebar error list ───────────────────────────────────────────────────────
function ErrorSidebar({ errors, total }) {
  const spellCount   = errors.filter(e => e.type === 'spelling').length
  const grammarCount = errors.filter(e => e.type === 'grammar').length
  const contextCount = errors.filter(e => e.type === 'contextual').length

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Editor Review</span>
        <div className="sidebar-counts">
          {spellCount > 0   && <span className="count-badge spell">{spellCount} spelling</span>}
          {grammarCount > 0 && <span className="count-badge grammar">{grammarCount} grammar</span>}
          {contextCount > 0 && <span className="count-badge context">{contextCount} contextual</span>}
          {errors.length === 0 && <span className="count-badge ok">✓ No issues</span>}
        </div>
      </div>

      <div className="sidebar-legend">
        <div className="legend-item">
          <span className="legend-line spell-line" /> Spelling
        </div>
        <div className="legend-item">
          <span className="legend-line grammar-line" /> Grammar
        </div>
        <div className="legend-item">
          <span className="legend-line context-line" /> Contextual
        </div>
      </div>

      <div className="error-list">
        {errors.length === 0 ? (
          <div className="no-errors">
            <div className="no-errors-icon">✓</div>
            <p>Your document looks great!</p>
          </div>
        ) : (
          errors.map((err, i) => (
            <div
              key={i}
              className={`error-item ${err.type}`}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <div className="error-item-header">
                <span className={`error-dot ${err.type}`} />
                <span className="error-word">"{err.word}"</span>
                <span className={`error-type-tag ${err.type}`}>
                  {err.type}
                </span>
              </div>
              <p className="error-msg">{err.message}</p>
              {err.suggestions?.length > 0 && (
                <div className="error-suggs">
                  {err.suggestions.slice(0, 3).map((s, j) => (
                    <span key={j} className={`sugg-tag ${err.type}`}>{s}</span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [errors, setErrors]         = useState([])
  const [loading, setLoading]       = useState(false)
  const [wordCount, setWordCount]   = useState(0)
  const [charCount, setCharCount]   = useState(0)
  const [tooltip, setTooltip]       = useState(null)  // { x, y, message, suggestions, type }
  const [apiStatus, setApiStatus]   = useState('checking') // checking | ok | error

  const editorRef   = useRef(null)
  const debounceRef = useRef(null)
  const errorsRef   = useRef([])
  const plainTextRef = useRef('')

  // ── Check API health on mount ──────────────────────────────────────────────
  useEffect(() => {
    axios.get(`${API}/health`)
      .then(() => setApiStatus('ok'))
      .catch(() => setApiStatus('error'))
  }, [])

  // ── Extract plain text from contenteditable ───────────────────────────────
  function getPlainText(el) {
    // Walk DOM to extract text, convert <br> to \n
    let text = ''
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent
      } else if (node.nodeName === 'BR') {
        text += '\n'
      } else {
        for (const child of node.childNodes) walk(child)
      }
    }
    walk(el)
    return text
  }

  // ── Update word/char count ─────────────────────────────────────────────────
  function updateCounts(text) {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0
    setWordCount(words)
    setCharCount(text.length)
  }

  // ── Apply highlights to editor ────────────────────────────────────────────
  function applyHighlights(text, errs) {
    const el = editorRef.current
    if (!el) return
    const caretPos = getCaretCharOffset(el)
    const html = buildHighlightedHTML(text, errs)
    el.innerHTML = html
    // Restore caret
    try { setCaretCharOffset(el, caretPos) } catch (_) {}
  }

  // ── Send text to API ───────────────────────────────────────────────────────
  async function checkText(text) {
    if (!text.trim()) {
      setErrors([])
      errorsRef.current = []
      applyHighlights(text, [])
      return
    }
    setLoading(true)
    try {
      const { data } = await axios.post(`${API}/check`, { text })
      setErrors(data)
      errorsRef.current = data
      applyHighlights(text, data)
    } catch {
      // API not reachable — clear errors silently
    } finally {
      setLoading(false)
    }
  }

  // ── Handle typing ──────────────────────────────────────────────────────────
  function handleInput() {
    const el = editorRef.current
    if (!el) return
    const text = getPlainText(el)
    plainTextRef.current = text
    updateCounts(text)
    setTooltip(null)

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => checkText(text), 600)
  }

  // ── Handle clicks on highlighted spans ───────────────────────────────────
  function handleEditorClick(e) {
    const span = e.target.closest('[data-msg]')
    if (!span) { setTooltip(null); return }

    const rect = span.getBoundingClientRect()
    const editorRect = editorRef.current.parentElement.getBoundingClientRect()

    setTooltip({
      x: rect.left - editorRect.left,
      y: rect.bottom - editorRect.top + 6,
      message: span.dataset.msg,
      suggestions: (span.dataset.sugg || '').split(',').filter(Boolean),
      type:
        span.classList.contains('err-spell')   ? 'spelling'   :
        span.classList.contains('err-grammar')  ? 'grammar'    :
                                                  'contextual',
    })
  }

  // ── Paste as plain text ────────────────────────────────────────────────────
  function handlePaste(e) {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  }

  // ── Keyboard: Tab inserts spaces ──────────────────────────────────────────
  function handleKeyDown(e) {
    if (e.key === 'Tab') {
      e.preventDefault()
      document.execCommand('insertText', false, '    ')
    }
  }

  return (
    <div className="app" onClick={() => setTooltip(null)}>

      {/* ── Ribbon ────────────────────────────────────────────── */}
      <div className="ribbon">
        <div className="ribbon-logo">
          <span className="ribbon-logo-icon">W</span>
          <span className="ribbon-logo-text">WriteRight</span>
        </div>
        <div className="ribbon-tabs">
          {['Home', 'Insert', 'View', 'Review'].map(t => (
            <button key={t} className={`ribbon-tab ${t === 'Home' ? 'active' : ''}`}>{t}</button>
          ))}
        </div>
        <div className="ribbon-right">
          <div className={`api-indicator ${apiStatus}`}>
            <span className="api-dot" />
            {apiStatus === 'ok' ? 'API Connected' : apiStatus === 'error' ? 'API Offline' : 'Connecting…'}
          </div>
        </div>
      </div>

      {/* ── Toolbar ───────────────────────────────────────────── */}
      <div className="toolbar">
        <div className="toolbar-group">
          <button className="tb-btn" title="Bold"><b>B</b></button>
          <button className="tb-btn" title="Italic"><i>I</i></button>
          <button className="tb-btn" title="Underline"><u>U</u></button>
        </div>
        <div className="toolbar-sep" />
        <div className="toolbar-group">
          <select className="tb-select" defaultValue="Lora">
            <option>Lora</option>
            <option>Times New Roman</option>
            <option>Georgia</option>
          </select>
          <select className="tb-select tb-select-sm" defaultValue="12">
            {[10,11,12,14,16,18,24,36].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="toolbar-sep" />
        <div className="toolbar-group">
          <button className="tb-btn">≡</button>
          <button className="tb-btn">≡</button>
          <button className="tb-btn">≡</button>
        </div>
        <div className="toolbar-sep" />
        <div className="check-legend">
          <span className="legend-pill spell-pill">Red = Spelling</span>
          <span className="legend-pill grammar-pill">Blue = Grammar</span>
          <span className="legend-pill context-pill">Green = Contextual</span>
        </div>
        {loading && <div className="checking-badge">⟳ Checking…</div>}
      </div>

      {/* ── Body ──────────────────────────────────────────────── */}
      <div className="body-area">

        {/* Canvas */}
        <div className="canvas-area">
          <div className="page-wrapper">
            {/* ruler */}
            <div className="ruler">
              {Array.from({ length: 17 }).map((_, i) => (
                <span key={i} className="ruler-mark">{i > 0 ? i : ''}</span>
              ))}
            </div>

            {/* The document page */}
            <div className="page" onClick={e => e.stopPropagation()}>
              {/* Tooltip */}
              {tooltip && (
                <Tooltip
                  x={tooltip.x}
                  y={tooltip.y}
                  message={tooltip.message}
                  suggestions={tooltip.suggestions}
                  type={tooltip.type}
                  onClose={() => setTooltip(null)}
                />
              )}

              {/* Contenteditable editor */}
              <div
                ref={editorRef}
                className="editor"
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                onInput={handleInput}
                onClick={handleEditorClick}
                onPaste={handlePaste}
                onKeyDown={handleKeyDown}
                data-placeholder="Start typing your document here…"
              />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <ErrorSidebar errors={errors} total={wordCount} />
      </div>

      {/* ── Status bar ────────────────────────────────────────── */}
      <div className="statusbar">
        <span>{wordCount} words</span>
        <span>{charCount} characters</span>
        <span className="status-sep">|</span>
        <span>
          {errors.filter(e => e.type === 'spelling').length} spelling &nbsp;
          {errors.filter(e => e.type === 'grammar').length} grammar &nbsp;
          {errors.filter(e => e.type === 'contextual').length} contextual
        </span>
        <span className="status-sep">|</span>
        <span>English (US)</span>
      </div>
    </div>
  )
}
