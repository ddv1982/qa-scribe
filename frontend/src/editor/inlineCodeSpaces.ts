// HTML parsing collapses each white space run, but inline code keeps its spaces, as the editor
// wrote them: the parser keeps white space inside an element styled `white-space: pre`. A line
// end in inline code reads as a space, as before, not as a hard break. The parser still trims
// the end of a block, so code ending a block with a space gets a guard after it, removed once
// parsed. The guard is a private-use run longer than any in the decoded text, where adjacent
// text nodes already read joined, so authored text never matches it.

/** Styles the inline code under `root` to keep its spaces, and returns the guard if one was added. */
export function keepInlineCodeSpaces(root: Element | DocumentFragment): string | null {
  let guard = ''
  while ((root.textContent ?? '').includes(guard)) guard += ''
  let guarded = false
  root.querySelectorAll('code').forEach((code) => {
    if (code.closest('pre')) return
    code.style.whiteSpace = 'pre'
    const texts = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
    while (texts.nextNode()) texts.currentNode.nodeValue = (texts.currentNode.nodeValue ?? '').replace(/\r\n?|\n/g, ' ')
    if (/\s$/.test(code.textContent ?? '') && endsItsBlock(code)) {
      code.after(guard)
      guarded = true
    }
  })
  return guarded ? guard : null
}

const inlineElements = new Set(['A', 'B', 'CODE', 'EM', 'I', 'LABEL', 'S', 'SPAN', 'STRIKE', 'STRONG', 'U'])

// Nothing but white space and line breaks follows the node up to its block, or up to a block
// that ends the paragraph the parser infers around loose inline content.
function endsItsBlock(node: Node): boolean {
  for (let current: Node | null = node; current && inlineElements.has(current.nodeName); current = current.parentNode) {
    for (let next = current.nextSibling; next; next = next.nextSibling) {
      if (next.nodeType === Node.TEXT_NODE) {
        if ((next.nodeValue ?? '').trim()) return false
      } else if (next.nodeName !== 'BR') {
        return !inlineElements.has(next.nodeName) && next.nodeName !== 'IMG'
      }
    }
  }
  return true
}
