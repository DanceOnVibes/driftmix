/**
 * "Cleared · Undo" for 10 seconds after a list is cleared, so one wrong tap
 * can't wipe it.
 */
export function UndoStrip({ undo, onUndo, testid }) {
  if (!undo) return null;
  return (
    <p className="undo-strip" role="status" data-testid={testid}>
      <span>{undo.text}</span>
      <button type="button" className="btn btn-ghost btn-small" onClick={onUndo} data-testid={`${testid}-btn`}>
        Undo
      </button>
    </p>
  );
}
