import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { Bot, ChevronDown, Command, Search, Sparkles } from 'lucide-react'
import type { ProviderModelDescriptor } from '../tauri'

// Accepts a plain string because provider descriptors carry `id: string`
// (the backend's `ProviderDescriptor.id`); the known `AiProvider` ids are a
// subset, and unknown values fall through to the default glyph.
export function ProviderGlyph({ provider }: { provider: string }) {
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
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const listboxRef = useRef<HTMLDivElement | null>(null)
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
      triggerRef.current?.focus()
      return
    }

    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const optionCount = filteredOptions.length + (showCustomOption ? 1 : 0)
      if (optionCount === 0) return
      event.preventDefault()
      focusModelOption(event.key === 'ArrowUp' || event.key === 'End' ? optionCount - 1 : 0)
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

  function focusModelOption(index: number) {
    const options = Array.from(listboxRef.current?.querySelectorAll<HTMLButtonElement>('button[role="option"]:not(:disabled)') ?? [])
    options[index]?.focus()
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'Escape') {
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return

    const optionCount = filteredOptions.length + (showCustomOption ? 1 : 0)
    if (optionCount === 0) return
    event.preventDefault()
    focusModelOption(optionIndexForKey(event.key, index, optionCount))
  }

  return (
    <div className="model-combobox" onBlur={handleBlur}>
      <button
        ref={triggerRef}
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
          <div ref={listboxRef} className="model-options" role="listbox" aria-label="AI models">
            {filteredOptions.map((model, index) => (
              <button
                key={model.id}
                className={model.id === currentValue ? 'model-option active' : 'model-option'}
                type="button"
                role="option"
                aria-selected={model.id === currentValue}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseModel(model.id)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
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
                onKeyDown={(event) => handleOptionKeyDown(event, filteredOptions.length)}
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

function optionIndexForKey(key: string, currentIndex: number, optionCount: number): number {
  if (key === 'Home') return 0
  if (key === 'End') return optionCount - 1
  if (key === 'ArrowUp') return Math.max(0, currentIndex - 1)
  return Math.min(optionCount - 1, currentIndex + 1)
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
