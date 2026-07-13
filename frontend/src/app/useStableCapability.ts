import { useEffect, useRef, useState } from 'react'

/**
 * Build a capability API once while letting its event handlers read the latest
 * state contract. Action factories must only close over the contract during
 * construction; property reads happen when a returned handler is invoked.
 */
export function useStableCapability<Context extends object, Actions>(
  context: Context,
  createActions: (context: Context) => Actions,
): Actions {
  const contextRef = useRef(context)
  useEffect(() => {
    contextRef.current = context
  }, [context])

  // The initializer only creates closures. The Proxy getter reads `.current`
  // later, when a returned event/effect callback accesses its context.
  // eslint-disable-next-line react-hooks/refs -- no ref value is read by the initializer or during rendering.
  const [actions] = useState(() => {
    const currentContext = new Proxy({} as Context, {
      get: (_target, property: string | symbol) => contextRef.current[property as keyof Context],
    })
    return createActions(currentContext)
  })
  return actions
}
