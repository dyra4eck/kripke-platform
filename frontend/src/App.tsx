import { useCallback, useEffect, useState } from "react";

import KripkeGraph, { parseEdgeId } from "./KripkeGraph";
import Inspector, { type Selection } from "./Inspector";
import { EXAMPLES } from "./examples";
import { health } from "./api";
import {
  EMPTY_MODEL,
  addState,
  addTransition,
  freshStateName,
  removeState,
  removeTransition,
} from "./edit";
import type { KripkeModel } from "./types/kripke";

export default function App() {
  const [model, setModel] = useState<KripkeModel>(EXAMPLES[0].model);
  const [selection, setSelection] = useState<Selection>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [rankDir, setRankDir] = useState<"LR" | "TB">("LR");
  const [layoutNonce, setLayoutNonce] = useState(0);
  const [backend, setBackend] = useState<"unknown" | "up" | "down">("unknown");
  // Only meaningful for the render that follows a rename; see KripkeGraph.
  const [renamed, setRenamed] = useState<{ from: string; to: string } | null>(
    null,
  );

  useEffect(() => {
    let alive = true;
    const poll = () =>
      health().then((ok) => alive && setBackend(ok ? "up" : "down"));
    poll();
    const timer = setInterval(poll, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const rename = useCallback((from: string, to: string) => {
    setRenamed({ from, to });
    setSelection({ kind: "state", id: to });
  }, []);

  const load = useCallback((next: KripkeModel) => {
    setModel(next);
    setRenamed(null);
    setSelection(null);
    setLayoutNonce((n) => n + 1);
  }, []);

  const onSelect = useCallback(
    (id: string | null, kind: "state" | "transition" | null) =>
      setSelection(id && kind ? { kind, id } : null),
    [],
  );

  const onAddTransition = useCallback(
    (from: string, to: string) => setModel((m) => addTransition(m, from, to)),
    [],
  );

  const remove = useCallback(() => {
    if (!selection) return;
    setModel((m) =>
      selection.kind === "state"
        ? removeState(m, selection.id)
        : removeTransition(m, ...parseEdgeId(selection.id)),
    );
    setSelection(null);
  }, [selection]);

  // Delete/Backspace removes the selection, unless a text field has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [remove]);

  return (
    <div className="app">
      <header className="bar">
        <h1>Kripke platform</h1>

        <select
          aria-label="Загрузить модель"
          value=""
          onChange={(e) => {
            const found = EXAMPLES.find((x) => x.id === e.target.value);
            if (found) load(found.model);
            else if (e.target.value === "__empty") load(EMPTY_MODEL);
          }}
        >
          <option value="" disabled>
            Загрузить…
          </option>
          {EXAMPLES.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
          <option value="__empty">Пустая модель</option>
        </select>

        <button
          onClick={() => {
            const name = freshStateName(model);
            setModel((m) => addState(m, name));
            setSelection({ kind: "state", id: name });
          }}
        >
          Добавить состояние
        </button>

        <button
          onClick={() => setConnectMode((v) => !v)}
          aria-pressed={connectMode}
          style={
            connectMode
              ? { borderColor: "var(--accent)", color: "var(--accent)" }
              : undefined
          }
        >
          {connectMode ? "Рисую переходы" : "Рисовать переходы"}
        </button>

        <button onClick={remove} disabled={!selection}>
          Удалить
        </button>

        <div className="spacer" />

        <button
          onClick={() => {
            setRankDir((d) => (d === "LR" ? "TB" : "LR"));
          }}
        >
          {rankDir === "LR" ? "Слева направо" : "Сверху вниз"}
        </button>
        <button onClick={() => setLayoutNonce((n) => n + 1)}>Разложить</button>

        <span className="health" data-state={backend}>
          {backend === "up"
            ? "Сервер отвечает"
            : backend === "down"
              ? "Сервер недоступен"
              : "Проверяю связь"}
        </span>
      </header>

      <div className="canvas">
        <KripkeGraph
          model={model}
          rankDir={rankDir}
          layoutNonce={layoutNonce}
          connectMode={connectMode}
          renamed={renamed}
          selectedId={selection?.id ?? null}
          onSelect={onSelect}
          onAddTransition={onAddTransition}
        />
        {connectMode && (
          <p className="hint">
            Потяните от края состояния к другому, чтобы создать переход.
          </p>
        )}
      </div>

      <Inspector
        model={model}
        selection={selection}
        onChange={setModel}
        onSelect={setSelection}
        onRename={rename}
      />
    </div>
  );
}
