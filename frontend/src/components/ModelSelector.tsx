import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { Bot, Check, ChevronDown, Command, Cpu, Search, Sparkles } from 'lucide-react'
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
  describedBy,
  providerLabel = 'CLI',
  resolvedDefaultModel = null,
  resolvedDefaultOrigin = null,
  onChange,
}: {
  disabled?: boolean
  models: ProviderModelDescriptor[]
  value: string
  describedBy?: string
  providerLabel?: string
  resolvedDefaultModel?: string | null
  resolvedDefaultOrigin?: string | null
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listboxId = useId()
  const options = models.length > 0 ? models : [defaultProviderModel()]
  const currentValue = value.trim() || 'default'
  const selected = options.find((model) => model.id === currentValue)
  const resolvedDefaultDescriptor = resolvedDefaultModel
    ? options.find((model) => model.id === resolvedDefaultModel)
    : null
  const resolvedDefaultLabel = resolvedDefaultDescriptor?.label ?? resolvedDefaultModel
  const selectedLabel = selected?.id === 'default'
    ? resolvedDefaultLabel ? `CLI default · ${resolvedDefaultLabel}` : 'CLI default'
    : selected?.label ?? currentValue
  const detectedModelCount = options.filter((model) => model.source === 'detected').length
  const selectableModelCount = options.filter((model) => model.id !== 'default').length
  const filteredOptions = options.filter((model) => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return true
    return `${model.label} ${model.id}`.toLocaleLowerCase().includes(normalizedQuery)
  })
  const customModel = query.trim()
  const exactMatch = options.some((model) => model.id.toLocaleLowerCase() === customModel.toLocaleLowerCase())
  const showCustomOption = customModel.length > 0 && !exactMatch
  const popoverOpen = open && !disabled
  const optionCount = filteredOptions.length + (showCustomOption ? 1 : 0)
  const activeOptionId = popoverOpen && optionCount > 0 && activeIndex >= 0
    ? `${listboxId}-option-${Math.min(activeIndex, optionCount - 1)}`
    : undefined

  useEffect(() => {
    if (!disabled || !open) return
    const timeout = window.setTimeout(() => setOpen(false), 0)
    return () => window.clearTimeout(timeout)
  }, [disabled, open])

  function chooseModel(modelId: string) {
    if (disabled) return
    onChange(modelId)
    setQuery('')
    setOpen(false)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextFocus = event.relatedTarget
    if (!(nextFocus instanceof Node) || !event.currentTarget.contains(nextFocus)) {
      setOpen(false)
    }
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      setQuery('')
      return
    }

    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if (optionCount === 0) return
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => optionIndexForKey(event.key, current, optionCount))
      return
    }

    if (event.key !== 'Enter') return
    event.preventDefault()
    const active = Math.min(activeIndex, Math.max(0, optionCount - 1))
    if (filteredOptions[active]) chooseModel(filteredOptions[active].id)
    else if (showCustomOption) chooseModel(customModel)
  }

  function openPicker() {
    if (disabled) return
    setQuery('')
    setActiveIndex(-1)
    setOpen(true)
  }

  function updateQuery(nextQuery: string) {
    setQuery(nextQuery)
    setActiveIndex(-1)
    setOpen(true)
  }

  return (
    <div className="model-combobox" onBlur={handleBlur}>
      <label className="model-combobox-trigger">
        <span className="model-combobox-label">
          <span className="ai-choice-icon"><Cpu size={17} /></span>
          <span>
            <strong>Model</strong>
            <small>{detectedModelCount > 0 ? `${modelCountLabel(detectedModelCount)} from ${providerLabel}` : 'CLI default or custom override'}</small>
          </span>
        </span>
        <span className="model-combobox-control">
          <input
            ref={inputRef}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={popoverOpen ? listboxId : undefined}
            aria-activedescendant={activeOptionId}
            aria-describedby={describedBy}
            aria-expanded={popoverOpen}
            aria-haspopup="listbox"
            aria-label="Model"
            disabled={disabled}
            placeholder={popoverOpen ? 'Search models…' : undefined}
            value={popoverOpen ? query : selectedLabel}
            onFocus={openPicker}
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <button type="button" aria-label="Open model choices" disabled={disabled} tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => {
            if (popoverOpen) setOpen(false)
            else {
              openPicker()
              inputRef.current?.focus()
            }
          }}>
            <ChevronDown size={15} />
          </button>
        </span>
      </label>
      {popoverOpen ? (
        <div className="model-combobox-popover">
          <div className="model-search-hint">
            <Search size={14} />
            {detectedModelCount > 0
              ? `${modelCountLabel(detectedModelCount)} reported by ${providerLabel}`
              : `${modelCountLabel(selectableModelCount, 'suggested model')} · custom IDs supported`}
          </div>
          <div id={listboxId} className="model-options" role="listbox" aria-label="AI models">
            {filteredOptions.map((model, index) => (
              <div
                id={`${listboxId}-option-${index}`}
                key={model.id}
                className={`${model.id === currentValue ? 'model-option selected' : 'model-option'}${index === activeIndex ? ' active' : ''}`}
                role="option"
                aria-selected={model.id === currentValue}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseModel(model.id)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="model-option-copy">
                  <strong>{model.id === 'default' ? 'CLI default' : model.label}</strong>
                  <small>{model.id === 'default'
                    ? defaultOptionDescription(resolvedDefaultLabel, resolvedDefaultOrigin)
                    : model.description ?? model.id}</small>
                </span>
                <span className="model-option-meta">
                  <em>{modelSourceLabel(model.source)}</em>
                  {model.id === currentValue ? <Check aria-hidden="true" size={15} /> : null}
                </span>
              </div>
            ))}
            {showCustomOption ? (
              <div
                id={`${listboxId}-option-${filteredOptions.length}`}
                className={`model-option custom${activeIndex === filteredOptions.length ? ' active' : ''}`}
                role="option"
                aria-selected={false}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseModel(customModel)}
                onMouseEnter={() => setActiveIndex(filteredOptions.length)}
              >
                <span className="model-option-copy">
                  <strong>Use custom model</strong>
                  <small>{customModel}</small>
                </span>
                <span className="model-option-meta"><em>Custom</em></span>
              </div>
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
  if (currentIndex < 0) return key === 'ArrowUp' ? optionCount - 1 : 0
  if (key === 'ArrowUp') return Math.max(0, currentIndex - 1)
  return Math.min(optionCount - 1, currentIndex + 1)
}

function defaultProviderModel(): ProviderModelDescriptor {
  return {
    id: 'default',
    label: 'Use CLI default',
    description: 'Use the model configured by the local provider CLI.',
    source: 'providerDefault',
    isDefault: true,
    reasoningEfforts: [],
    defaultReasoningEffort: null,
  }
}

function modelSourceLabel(source: ProviderModelDescriptor['source']): string {
  if (source === 'detected') return 'CLI'
  if (source === 'environment') return 'Config'
  if (source === 'preset') return 'Suggested'
  return 'Default'
}

function defaultOptionDescription(model: string | null | undefined, origin: string | null): string {
  if (!model) return 'Let the CLI choose when generation starts.'
  return `Current: ${model}${origin ? ` · ${origin}` : ''}`
}

function modelCountLabel(count: number, noun = 'model'): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
