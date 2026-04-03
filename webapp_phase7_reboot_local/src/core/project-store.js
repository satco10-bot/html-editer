export function createProjectStore() {
  const listeners = new Set();
  const state = {
    project: null,
    editorMeta: null,
    statusText: '대기 중',
    currentView: 'preview',
    selectionMode: 'smart',
  };

  function notify() {
    for (const listener of listeners) listener(getState());
  }

  function getState() {
    return {
      project: state.project,
      editorMeta: state.editorMeta,
      statusText: state.statusText,
      currentView: state.currentView,
      selectionMode: state.selectionMode,
    };
  }

  function setProject(project) {
    if (state.project?.releaseResources) {
      try { state.project.releaseResources(); } catch {}
    }
    state.project = project;
    state.editorMeta = null;
    notify();
  }

  function updateProject(mutator) {
    if (!state.project) return;
    const result = typeof mutator === 'function' ? mutator(state.project) : null;
    if (result && typeof result === 'object') state.project = result;
    notify();
  }

  function setEditorMeta(meta) {
    state.editorMeta = meta || null;
    notify();
  }

  function setStatus(text) {
    state.statusText = String(text || '대기 중');
    notify();
  }

  function setView(view) {
    state.currentView = view || 'preview';
    notify();
  }

  function setSelectionMode(mode) {
    state.selectionMode = mode || 'smart';
    notify();
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(getState());
    return () => listeners.delete(listener);
  }

  return { getState, setProject, updateProject, setEditorMeta, setStatus, setView, setSelectionMode, subscribe };
}
