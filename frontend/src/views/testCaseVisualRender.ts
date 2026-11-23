import type { DiagramNode, TestCaseVisualAction, VisualRegion } from '../bindings'

type Point = { x: number; y: number }
type Rect = Point & { width: number; height: number }
type Diagram = Extract<TestCaseVisualAction, { kind: 'diagram' }>
type Annotate = Extract<TestCaseVisualAction, { kind: 'annotate' }>

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image rendering is unavailable.')
  return { canvas, context }
}

function arrow(context: CanvasRenderingContext2D, from: Point, to: Point, color: string, width: number) {
  const direction = Math.atan2(to.y - from.y, to.x - from.x)
  context.strokeStyle = color
  context.fillStyle = color
  context.lineWidth = width
  context.lineCap = 'round'
  context.beginPath()
  context.moveTo(from.x, from.y)
  context.lineTo(to.x, to.y)
  context.stroke()
  context.beginPath()
  context.moveTo(to.x, to.y)
  for (const angle of [direction - Math.PI / 6, direction + Math.PI / 6]) {
    context.lineTo(to.x - width * 4 * Math.cos(angle), to.y - width * 4 * Math.sin(angle))
  }
  context.closePath()
  context.fill()
}

function wrap(context: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = []
  let line = ''
  for (const word of text.trim().split(/\s+/u)) {
    if (line && context.measureText(`${line} ${word}`).width > width) {
      lines.push(line)
      line = ''
    }
    if (line) line += ' '
    for (const character of word) {
      if (line && context.measureText(line + character).width > width) {
        lines.push(line)
        line = ''
      }
      line += character
    }
  }
  if (line) lines.push(line)
  return lines
}

function wrappedLabel(context: CanvasRenderingContext2D, label: string, box: Rect) {
  for (const size of [19, 17, 14]) {
    context.font = `600 ${size}px system-ui, sans-serif`
    const lines = wrap(context, label, box.width - 24)
    const leading = size + 3
    if (lines.length * leading <= box.height - 8 || size === 14) {
      lines.forEach((line, index) => {
        context.fillText(line, box.x, box.y + (index - (lines.length - 1) / 2) * leading)
      })
      return
    }
  }
}

function edgeEndpoint(from: Rect, to: Rect): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const scale = Math.min((from.width / 2 + 4) / Math.abs(dx), (from.height / 2 + 4) / Math.abs(dy))
  return { x: from.x + dx * scale, y: from.y + dy * scale }
}

export function renderDiagram(action: Diagram): string {
  const minRow = Math.min(...action.nodes.map(node => node.row))
  const minColumn = Math.min(...action.nodes.map(node => node.column))
  const columns = Math.max(...action.nodes.map(node => node.column)) - minColumn + 1
  const rows = Math.max(...action.nodes.map(node => node.row)) - minRow + 1
  const margin = 20
  const boxWidth = 220
  const boxHeight = 86
  const columnGap = 50
  const rowGap = 36
  const width = columns * boxWidth + (columns - 1) * columnGap + margin * 2
  const height = rows * boxHeight + (rows - 1) * rowGap + margin * 2
  const { canvas, context } = createCanvas(width * 2, height * 2)
  context.scale(2, 2)
  context.fillStyle = '#f5f8fc'
  context.fillRect(0, 0, width, height)
  context.textAlign = 'center'
  context.textBaseline = 'middle'

  const boxes = action.nodes.map((node: DiagramNode): Rect => ({
    x: margin + boxWidth / 2 + (node.column - minColumn) * (boxWidth + columnGap),
    y: margin + boxHeight / 2 + (node.row - minRow) * (boxHeight + rowGap),
    width: boxWidth,
    height: boxHeight,
  }))
  for (const edge of action.edges) {
    const from = boxes[edge.from]
    const to = boxes[edge.to]
    const start = edgeEndpoint(from, to)
    const end = edgeEndpoint(to, from)
    arrow(context, start, end, '#236051', 2.75)
  }
  for (const [index, node] of action.nodes.entries()) {
    const box = boxes[index]
    context.beginPath()
    context.roundRect(box.x - box.width / 2, box.y - box.height / 2, box.width, box.height, 10)
    context.fillStyle = '#ffffff'
    context.fill()
    context.strokeStyle = '#478275'
    context.lineWidth = 1.5
    context.stroke()
    context.fillStyle = '#16302a'
    wrappedLabel(context, node.label, box)
  }
  for (const edge of action.edges) {
    if (!edge.label) continue
    const from = boxes[edge.from]
    const to = boxes[edge.to]
    const x = (from.x + to.x) / 2
    const y = (from.y + to.y) / 2
    context.font = '600 14px system-ui, sans-serif'
    const lines = wrap(context, edge.label, 96)
    const labelWidth = Math.max(...lines.map(line => context.measureText(line).width)) + 12
    const labelHeight = lines.length * 17 + 3
    context.fillStyle = '#f5f8fc'
    context.fillRect(x - labelWidth / 2, y - labelHeight / 2, labelWidth, labelHeight)
    context.fillStyle = '#236051'
    lines.forEach((line, index) => context.fillText(line, x, y + (index - (lines.length - 1) / 2) * 17))
  }
  return canvas.toDataURL('image/png')
}

function scaledRegion(region: VisualRegion, width: number, height: number): Rect {
  const x = Math.floor(region.x * width / 1000)
  const y = Math.floor(region.y * height / 1000)
  return {
    x,
    y,
    width: Math.ceil((region.x + region.width) * width / 1000) - x,
    height: Math.ceil((region.y + region.height) * height / 1000) - y,
  }
}

export async function renderScreenshot(action: Annotate, source: string): Promise<string> {
  const image = new Image()
  image.src = source
  await image.decode()
  const pixels = image.naturalWidth * image.naturalHeight
  const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight), Math.sqrt(6_000_000 / pixels))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const crop = action.edits.find(edit => edit.kind === 'crop')
  const view = crop ? scaledRegion(crop.region, width, height) : { x: 0, y: 0, width, height }
  const { canvas, context } = createCanvas(view.width, view.height)
  const line = Math.max(3, Math.min(width, height) / 200)
  const point = (coordinates: [number, number]) => ({ x: coordinates[0] * width / 1000, y: coordinates[1] * height / 1000 })
  context.translate(-view.x, -view.y)
  context.drawImage(image, 0, 0, width, height)
  for (const edit of action.edits) {
    if (edit.kind === 'highlight') {
      const { x, y, width: w, height: h } = scaledRegion(edit.region, width, height)
      context.lineWidth = line
      context.strokeStyle = '#d65210'
      context.strokeRect(x, y, w, h)
    } else if (edit.kind === 'arrow') {
      arrow(context, point(edit.from), point(edit.to), '#d65210', line)
    }
  }
  for (const edit of action.edits) {
    if (edit.kind !== 'redact') continue
    const { x, y, width: w, height: h } = scaledRegion(edit.region, width, height)
    context.fillStyle = '#000000'
    context.fillRect(x - 1, y - 1, w + 2, h + 2)
  }
  return canvas.toDataURL('image/png')
}
