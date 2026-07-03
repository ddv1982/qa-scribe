import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { Bot, ChevronDown, Command, Search, Sparkles } from 'lucide-react'
import type { AiProvider, ProviderModelDescriptor } from '../tauri'

// Accepts a plain string because provider descriptors carry `id: string`
// (the backend's `ProviderDescriptor.id`); unknown values fall through to the
// default glyph.
export function ProviderGlyph({ provider }: { provider: AiProvider | string }) {
  if (provider === 'claude_code') return <Sparkles size={17} />
  if (provider === 'copilot_cli') return <Bot size={17} />
  return <Command size={17} />
}

export function ModelCombobox({
  disabled = false,
  models,
  value,
  onChange,
}: {
  disabled?: boolean
  models: ProviderModelDescriptor[]
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)
  const options = models.length > 0 ? models : [defaultProviderModel()]
  const currentValue = value.trim() || 'default'
  const selected = options.find((model) => model.id === currentValue)
  const selectedLabel = selected?.label ?? currentValue
  const filteredOptions = options.filter((model) => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return true
    return `${model.label} ${model.id}`.toLocaleLowerCase().includes(normalizedQuery)
  })
  const customModel = query.trim()
  const exactMatch = options.some((model) => model.id.toLocaleLowerCase() === customModel.toLocaleLowerCase())
  const showCustomOption = customModel.length > 0 && !exactMatch
  const popoverOpen = open && !disabled

  useEffect(() => {
    if (!disabled || !open) return
    const timeout = window.setTimeout(() => setOpen(false), 0)
    return () => window.clearTimeout(timeout)
  }, [disabled, open])

  useEffect(() => {
    if (!popoverOpen) return
    const timeout = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => window.clearTimeout(timeout)
  }, [popoverOpen])

  function chooseModel(modelId: string) {
    if (disabled) return
    onChange(modelId)
    setOpen(false)
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextFocus = event.relatedTarget
    if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) {
      setOpen(false)
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }

    if (event.key !== 'Enter') return
    event.preventDefault()
    if (showCustomOption) {
      chooseModel(customModel)
    } else if (filteredOptions[0]) {
      chooseModel(filteredOptions[0].id)
    }
  }

  function toggleOpen() {
    if (disabled) return
    if (open) {
      setOpen(false)
      return
    }
    setQuery('')
    setOpen(true)
  }

  return (
    <div className="model-combobox" onBlur={handleBlur}>
      <button
        className="model-combobox-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={popoverOpen}
        disabled={disabled}
        onClick={toggleOpen}
      >
        <span>Model</span>
        <strong>{selectedLabel}</strong>
        <ChevronDown size={15} />
      </button>
      {popoverOpen ? (
        <div className="model-combobox-popover">
          <label className="model-search">
            <Search size={15} />
            <span className="sr-only">Search AI models</span>
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handleSearchKeyDown} placeholder="Search models..." />
          </label>
          <div className="model-options" role="listbox" aria-label="AI models">
            {filteredOptions.map((model) => (
              <button
                key={model.id}
                className={model.id === currentValue ? 'model-option active' : 'model-option'}
                type="button"
                role="option"
                aria-selected={model.id === currentValue}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseModel(model.id)}
              >
                <span>
                  <strong>{model.label}</strong>
                  <small>{model.id}</small>
                </span>
                <em>{modelSourceLabel(model.source)}</em>
              </button>
            ))}
            {showCustomOption ? (
              <button
                className="model-option custom"
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseModel(customModel)}
              >
                <span>
                  <strong>Use custom model</strong>
                  <small>{customModel}</small>
                </span>
                <em>Custom</em>
              </button>
            ) : null}
            {filteredOptions.length === 0 && !showCustomOption ? <p className="model-options-empty">No matching models</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function defaultProviderModel(): ProviderModelDescriptor {
  return {
    id: 'default',
    label: 'Provider default',
    description: 'Use the model configured by the local provider CLI.',
    source: 'providerDefault',
    isDefault: true,
    reasoningEfforts: [],
  }
}

function modelSourceLabel(source: ProviderModelDescriptor['source']): string {
  if (source === 'detected') return 'Detected'
  if (source === 'environment') return 'Env'
  if (source === 'preset') return 'Preset'
  return 'Default'
}
