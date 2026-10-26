import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { parse } from '@babel/parser'
import type { Node } from '@babel/types'
import type { Plugin } from 'vite'

export const recoveryTraceTargets = /\/AppShell\.askAi\.(navigation|recovery|preparing)\.test\.tsx$/

export function recoveryTracePlugin(): Plugin {
  return {
    name: 'qa-recovery-trace',
    enforce: 'pre',
    apply: (_config, environment) => environment.command === 'serve' && environment.mode === 'test' && process.env.CI === 'true',
    transform(source, id) {
      id = id.split('?')[0].replaceAll('\\', '/')
      const target = recoveryTraceTargets.test(id)
      const module = id.match(/\/(useAskAiContext|useAppController\.navigation|sessionChat\.actions|useRecordHydration)\.ts$/)?.[1]
      const harness = id.endsWith('/app/useAppController.testHarness.ts')
      if (!target && !module && !harness) return
      const insertions = new Map<number, string[]>()
      const add = (position: number, text: string, first = false) => {
        const entries = insertions.get(position) ?? []
        if (first) entries.unshift(text); else entries.push(text)
        insertions.set(position, entries)
      }
      const wrap = (node: Node, prefix: string, suffix: string) => {
        add(node.start!, prefix); add(node.end!, suffix, true)
      }
      const label = (node: Node) => `${module}:${node.loc!.start.line}`
      const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
      const visit = (node: Node) => {
        if (module && node.type === 'AwaitExpression') {
          const operation = node.argument.type === 'CallExpression' ? source.slice(node.argument.callee.start!, node.argument.callee.end!) : node.argument.type === 'Identifier' ? node.argument.name : node.argument.type
          wrap(node.argument, `__qrWait('await:${operation}:${label(node)}', `, ', __qrScope)')
        }
        if (module && node.type === 'CallExpression' && node.callee.type === 'Identifier') {
          if (/^(getConversation|activateConversation|beginRecordChat|saveChatComposer|listFindings|listDrafts|listChatHistory)$/.test(node.callee.name)) {
            const reference = /^(getConversation|activateConversation)$/.test(node.callee.name) ? source.slice(node.arguments[0].start!, node.arguments[0].end!) : node.callee.name === 'saveChatComposer' ? 'entry.reference' : null
            wrap(node, `__qrWait('api:${node.callee.name}:${label(node)}', `, reference ? `, () => ({ ...__qrScope(), reference: ${reference} }))` : ', __qrScope)')
          } else if (node.callee.name === 'current') wrap(node, `__qrDecision('current:${label(node)}', `, ', { ...__qrScope(), capturedEpoch: epoch })')
        }
        if (module === 'useAskAiContext') {
          if (node.type === 'FunctionDeclaration' && /^(setPanel|onSelectRecord|acknowledgeReveal|invalidateNavigation|close|openConversation|onAskAi)$/.test(node.id?.name ?? '')) {
            add(node.body.start! + 1, `;__qrEvent('enter:${node.id!.name}', __qrScope());`)
            add(node.body.end! - 1, `;__qrEvent('exit:${node.id!.name}', __qrScope());`)
          }
          if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier' && node.callee.property.name === 'finish') {
            wrap(node, `(__qrEvent('reveal:finish', __qrScope()), `, ')')
          }
        }
        if (module === 'useRecordHydration' && node.type === 'IfStatement' && source.slice(node.test.start!, node.test.end!).includes('loadVersion')) {
          wrap(node.test, `__qrDecision('source-invalid:${label(node)}', `, ', __qrScope())')
        }
        if (target && node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'within') wrap(node, '__qrQueries(', ')')
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) (value as unknown[]).forEach(child => { if (child && typeof child === 'object' && 'type' in child) visit(child as Node) })
          else if (value && typeof value === 'object' && 'type' in value) visit(value as Node)
        }
      }
      visit(ast.program)
      for (const [position, entries] of [...insertions].sort(([left], [right]) => right - left)) source = source.slice(0, position) + entries.join('') + source.slice(position)
      if (module === 'useAskAiContext') source = source.replace('const recoveryEpoch = useRef(0)', `const recoveryEpoch = useRef(0)
        const __qrScope = () => ({ sessionId: live.current.sessionId, view: live.current.view, openingEpoch: openingEpoch.current, selectionEpoch: selectionEpoch.current, selected: selected.current && { kind: selected.current.kind, recordId: selected.current.recordId }, panel: panelRef.current && { owner: panelRef.current.owner, reference: panelRef.current.reference, phase: panelRef.current.phase, open: panelRef.current.open }, reveal: revealWaiter.current?.request, internalReveal: internalReveal.current, launches: [...attempts.current.values()].slice(0, 3).map(row => ({ owner: row.owner, reference: row.reference, pending: Boolean(row.pending) })) })`)
      if (module === 'useAppController.navigation') source = source.replace('function beginSessionNavigation()', `const __qrScope = () => ({ sessionId: ctx.activeSessionIdRef.current, view: ctx.activeView, pendingNavigationEpoch: ctx.pendingNavigationEpochRef.current })
        function beginSessionNavigation()`)
      if (module === 'sessionChat.actions') source = source.replace('let activatedSessionId: string | null = null', `let activatedSessionId: string | null = null
        const __qrScope = () => ({ sessionId: ctx.session.activeSessionIdRef.current, activationEpoch, selectionRequest, conversationEpoch: registry.epoch() })`)
      if (module === 'useRecordHydration') source = source.replace('const activeSessionIdRef = useRef(activeSessionId)', `const activeSessionIdRef = useRef(activeSessionId)
        const __qrScope = () => ({ sessionId: activeSessionIdRef.current, draftVersion: draftLoadVersionRef.current, findingVersion: findingLoadVersionRef.current })`)
      if (harness) source = source.replace('export function deferred<T>() {', `export function deferred<T>() {
        const observer = globalThis.__qaRecoveryTrace
        const id = observer?.event('deferred:create', {})`)
        .replace('resolve = nextResolve', "resolve = observer ? value => { observer.event('deferred:release', { id }); nextResolve(value) } : nextResolve")
        .replace('return { promise, resolve }', "observer?.wait('deferred:promise', promise, () => ({ id })); return { promise, resolve }")
      return `const __qrEvent = (label, scope) => globalThis.__qaRecoveryTrace?.event(label, scope);
        const __qrWait = (label, value, scope) => globalThis.__qaRecoveryTrace?.wait(label, value, scope) ?? value;
        const __qrDecision = (label, value, scope) => { __qrEvent(label, { ...scope, value }); return value };
        const __qrQueries = queries => globalThis.__qaRecoveryTrace?.queries(queries) ?? queries;
        ${source}`
    },
  }
}

export default defineConfig(({ command, mode }) => {
  const traceRecovery = command === 'serve' && mode === 'test' && process.env.CI === 'true'
  return {
    plugins: [react(), ...(traceRecovery ? [recoveryTracePlugin()] : [])],
    ...(traceRecovery ? { define: { 'import.meta.env.QA_RECOVERY_TRACE': 'true' } } : {}),
    clearScreen: false,
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('@tiptap') || id.includes('prosemirror')) return 'editor'
            if (id.includes('lucide-react')) return 'icons'
            return 'vendor'
          }
        }
      }
    },
    server: {
      strictPort: true,
      port: 5173
    },
    test: {
      environment: 'jsdom',
      // Bound JSDOM contention on developer desktops and shared CI hosts.
      maxWorkers: 2,
      setupFiles: ['./src/test/dialogPolyfill.ts', ...(traceRecovery ? ['./src/test/recoveryTrace.ts'] : [])]
    }
  }
})
