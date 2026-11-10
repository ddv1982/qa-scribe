import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import { BrandMark } from './BrandMark'
import faviconSource from '../../public/favicon.svg?raw'

const geometry = (root: ParentNode) => [...root.querySelectorAll('rect, circle')].map((node) =>
  ['x', 'y', 'width', 'height', 'rx', 'cx', 'cy', 'r', 'stroke-width'].map((name) => node.getAttribute(name)).join(','))

it('draws the same mark as the generated favicon', () => {
  const favicon = new DOMParser().parseFromString(faviconSource, 'image/svg+xml')
  const { container } = render(<BrandMark />)
  expect(geometry(container)).toEqual(geometry(favicon))
})
