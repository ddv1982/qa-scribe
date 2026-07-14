import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { Bot, Check, ChevronDown, Command, Cpu, Search, Sparkles } from 'lucide-react'
import type { ProviderModelDescriptor } from '../tauri'

export type ModelCatalogEntry = ProviderModelDescriptor

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
  catalogChecked = false,
  onChange,
}: {
  disabled?: boolean
  models: ModelCatalogEntry[]
  value: string
  describedBy?: string
  providerLabel?: string
  resolvedDefaultModel?: string | null
  resolvedDefaultOrigin?: string | null
  catalogChecked?: boolean
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
    ? resolvedDefaultLabel ? `CLI default · ${resolvedDefaultLabel}` : providerManagedModelLabel('default')
    : selected?.id === 'auto'
      ? providerManagedModelLabel('auto')
    : selected?.label ?? currentValue
  const authoritySummary = modelAuthoritySummary(options)
  const filteredOptions = options.filter((model) => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return true
    return `${model.label} ${model.id}`.toLocaleLowerCase().includes(normalizedQuery)
  })
  const customModel = query.trim()
  const exactMatch = options.some((model) => model.id.toLocaleLowerCase() === customModel.toLocaleLowerCase())
  const showCustomOption = customModel.length > 0 && !exactMatch
  const customSelectionAbsent = catalogChecked
    && !isProviderManagedModel(currentValue)
    && !options.some((model) => model.id === currentValue)
  const popoverOpen = open && !disabled
  const optionCount = filteredOptions.length + (showCustomOption ? 1 : 0)
  const disabledOptionIndexes = new Set(filteredOptions
    .map((model, index) => isModelSelectable(model) ? null : index)
    .filter((index): index is number => index !== null))
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
      setActiveIndex((current) => optionIndexForKey(event.key, current, optionCount, disabledOptionIndexes))
      return
    }

    if (event.key !== 'Enter') return
    event.preventDefault()
    const active = Math.min(activeIndex, Math.max(0, optionCount - 1))
    if (filteredOptions[active] && isModelSelectable(filteredOptions[active])) chooseModel(filteredOptions[active].id)
    else if (showCustomOption && active === filteredOptions.length) chooseModel(customModel)
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
            <small>{authoritySummary ?? 'CLI default or custom override'}</small>
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
      {customSelectionAbsent ? (
        <p className="field-description" role="status">
          Custom model “{currentValue}” is not in the current catalog. The CLI will validate it at run time.
        </p>
      ) : null}
      {popoverOpen ? (
        <div className="model-combobox-popover">
          <div className="model-search-hint">
            <Search size={14} />
            {authoritySummary
              ? `${authoritySummary} · custom IDs supported`
              : `${providerLabel} default · custom IDs supported`}
          </div>
          <div id={listboxId} className="model-options" role="listbox" aria-label="AI models">
            {filteredOptions.map((model, index) => {
              const selectable = isModelSelectable(model)
              return (
                <div
                  id={`${listboxId}-option-${index}`}
                  key={model.id}
                  className={`${model.id === currentValue ? 'model-option selected' : 'model-option'}${index === activeIndex ? ' active' : ''}${selectable ? '' : ' disabled'}`}
                  role="option"
                  aria-disabled={!selectable}
                  aria-selected={model.id === currentValue}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => { if (selectable) chooseModel(model.id) }}
                  onMouseEnter={() => { if (selectable) setActiveIndex(index) }}
                >
                  <span className="model-option-copy">
                    <strong>{isProviderManagedModel(model.id) ? providerManagedModelLabel(model.id) : model.label}</strong>
                    <small>{model.id === 'default'
                      ? defaultOptionDescription(resolvedDefaultLabel, resolvedDefaultOrigin)
                      : modelOptionDescription(model)}</small>
                  </span>
                  <span className="model-option-meta">
                    <em>{modelSourceLabel(model)}</em>
                    {model.id === currentValue ? <Check aria-hidden="true" size={15} /> : null}
                  </span>
                </div>
              )
            })}
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

function optionIndexForKey(
  key: string,
  currentIndex: number,
  optionCount: number,
  disabledIndexes: Set<number>,
): number {
  const selectable = Array.from({ length: optionCount }, (_, index) => index)
    .filter((index) => !disabledIndexes.has(index))
  if (selectable.length === 0) return -1
  if (key === 'Home') return selectable[0]
  if (key === 'End') return selectable.at(-1) ?? selectable[0]
  if (currentIndex < 0) return key === 'ArrowUp' ? selectable.at(-1) ?? selectable[0] : selectable[0]
  if (key === 'ArrowUp') {
    return selectable.filter((index) => index < currentIndex).at(-1) ?? selectable[0]
  }
  return selectable.find((index) => index > currentIndex) ?? selectable.at(-1) ?? selectable[0]
}

function defaultProviderModel(): ModelCatalogEntry {
  return {
    id: 'default',
    label: 'Use CLI default',
    description: 'Use the model configured by the local provider CLI.',
    source: 'providerDefault',
    availability: 'available',
    confidence: 'observed',
    isDefault: true,
    reasoningEfforts: [],
    defaultReasoningEffort: null,
    capabilities: {
      vision: null,
      reasoning: null,
      adaptiveThinking: null,
      fastMode: null,
      autoMode: null,
      contextWindowTokens: null,
      maxOutputTokens: null,
    },
    resolvedModel: null,
  }
}

function modelSourceLabel(model: ModelCatalogEntry): string {
  if (isProviderManagedModel(model.id) || model.source === 'providerDefault') return 'Default'
  if (['policyDisabled', 'unconfigured'].includes(model.availability)) return 'Policy'
  if (['config', 'environment'].includes(model.source)) return 'Config'
  if (model.availability === 'staticHint' || model.source === 'preset') return 'Suggested'
  if (model.availability === 'supportedByBinary' || ['cliHelp', 'detected'].includes(model.source)) return 'CLI'
  if (model.availability === 'available' || model.source === 'cliCatalog') return 'Account'
  return 'Default'
}

function modelAuthoritySummary(models: ModelCatalogEntry[]): string | null {
  const explicitModels = models.filter((model) => !isProviderManagedModel(model.id))
  const accountCount = explicitModels.filter((model) => !['policyDisabled', 'unconfigured'].includes(model.availability)
    && (model.source === 'cliCatalog'
      || (model.availability === 'available' && !['config', 'environment'].includes(model.source)))).length
  if (accountCount > 0) return `${modelCountLabel(accountCount)} available for this account`
  const cliCount = explicitModels.filter((model) => model.availability === 'supportedByBinary'
    || ['cliHelp', 'detected'].includes(model.source)).length
  if (cliCount > 0) return `${modelCountLabel(cliCount)} recognized by CLI`
  const suggestedCount = explicitModels.filter((model) => model.availability === 'staticHint'
    || model.source === 'preset').length
  if (suggestedCount > 0) return `${modelCountLabel(suggestedCount)} in static fallback`
  const configCount = explicitModels.filter((model) => ['config', 'environment'].includes(model.source)).length
  if (configCount > 0) return `${modelCountLabel(configCount)} from CLI configuration`
  return null
}

function modelOptionDescription(model: ModelCatalogEntry): string {
  if (model.availability === 'policyDisabled') return 'Disabled by account or organization policy.'
  if (model.availability === 'unconfigured') return 'Model access is not configured for this account.'
  if (model.availability === 'supportedByBinary') return model.description ?? 'Recognized by the installed CLI; account availability is not confirmed.'
  if (model.availability === 'staticHint') return model.description ?? 'Static fallback; the CLI validates availability at run time.'
  const resolution = model.resolvedModel && model.resolvedModel !== model.id
    ? `Resolves to ${model.resolvedModel}.`
    : null
  return [model.description, resolution].filter(Boolean).join(' ') || model.id
}

function isModelSelectable(model: ModelCatalogEntry): boolean {
  return !['policyDisabled', 'unconfigured'].includes(model.availability)
}

function isProviderManagedModel(modelId: string): boolean {
  return modelId.toLocaleLowerCase() === 'default' || modelId.toLocaleLowerCase() === 'auto'
}

function providerManagedModelLabel(modelId: string): string {
  return modelId.toLocaleLowerCase() === 'auto' ? 'CLI automatic' : 'CLI default'
}

function defaultOptionDescription(model: string | null | undefined, origin: string | null): string {
  if (!model) return 'Let the CLI choose when generation starts.'
  return `Current: ${model}${origin ? ` · ${origin}` : ''}`
}

function modelCountLabel(count: number, noun = 'model'): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
