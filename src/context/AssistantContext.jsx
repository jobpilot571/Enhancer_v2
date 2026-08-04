import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const AssistantContext = createContext(null)

export function AssistantProvider({ children }) {
  const [workspace, setWorkspaceState] = useState({
    service: null,
    sessionId: null,
    hasPreview: false,
    label: '',
    meta: {},
  })

  const setWorkspace = useCallback((patch) => {
    setWorkspaceState((prev) => ({
      ...prev,
      ...(typeof patch === 'function' ? patch(prev) : patch),
    }))
  }, [])

  const clearWorkspace = useCallback(() => {
    setWorkspaceState({
      service: null,
      sessionId: null,
      hasPreview: false,
      label: '',
      meta: {},
    })
  }, [])

  const value = useMemo(() => ({
    workspace,
    setWorkspace,
    clearWorkspace,
  }), [workspace, setWorkspace, clearWorkspace])

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  )
}

export function useAssistantWorkspace() {
  const ctx = useContext(AssistantContext)
  if (!ctx) {
    return {
      workspace: {
        service: null,
        sessionId: null,
        hasPreview: false,
        label: '',
        meta: {},
      },
      setWorkspace: () => {},
      clearWorkspace: () => {},
    }
  }
  return ctx
}
