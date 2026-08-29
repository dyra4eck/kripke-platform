import { useCallback, useEffect, useMemo, useState } from "react";

import KripkeGraph, { parseEdgeId } from "./KripkeGraph";
import Inspector, { type Selection } from "./Inspector";
import Results, { type Verification } from "./Results";
import { EXAMPLES } from "./examples";
import { ApiError, health, verify } from "./api";
import { ImportError, exportJson, exportSmv, readModelFile } from "./files";
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
  const [verification, setVerification] = useState<Verification>({
    status: "idle",
    result: null,
    errors: [],
  });
  const [openVerdict, setOpenVerdict] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [dropping, setDropping] = useState(false);
  const [notice, setNotice] = useState<string[] | null>(null);

  // Any edit invalidates the last run: showing verdicts for a model that no
  // longer exists is worse than showing none.
  const editModel = useCallback((next: KripkeModel) => {
    setModel(next);
    setVerification({ status: "idle", result: null, errors: [] });
    setOpenVerdict(null);
  }, []);

  const run = useCallback(async () => {
    setVerification({ status: "running", result: null, errors: [] });
    setOpenVerdict(null);
    try {
      const result = await verify(model);
      setVerification({ status: "done", result, errors: [] });
    } catch (error) {
      const errors =
        error instanceof ApiError
          ? error.errors
          : [error instanceof Error ? error.message : String(error)];
      setVerification({ status: "failed", result: null, errors });
    }
  }, [model]);

  const trace = useMemo(() => {
    const verdict =
      openVerdict === null
        ? null
        : (verification.result?.check?.verdicts[openVerdict] ?? null);
    if (!verdict) return null;
    return verdict.trace
      .map((s) => s.state)
      .filter((s): s is string => typeof s === "string");
  }, [verification, openVerdict]);

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

  const importFile = useCallback(
    async (file: File) => {
      try {
        const imported = await readModelFile(file);
        setModel(imported);
        setSelection(null);
        setRenamed(null);
        setVerification({ status: "idle", result: null, errors: [] });
        setOpenVerdict(null);
        setLayoutNonce((n) => n + 1);
        setNotice(null);
      } catch (error) {
        setNotice(
          error instanceof ImportError
            ? error.problems
            : [error instanceof Error ? error.message : String(error)],
        );
      }
    },
    [],
  );

  const load = useCallback((next: KripkeModel) => {
    setModel(next);
    setVerification({ status: "idle", result: null, errors: [] });
    setOpenVerdict(null);
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
    (from: string, to: string) => editModel(addTransition(model, from, to)),
    [editModel, model],
  );

  const remove = useCallback(() => {
    if (!selection) return;
    editModel(
      selection.kind === "state"
        ? removeState(model, selection.id)
        : removeTransition(model, ...parseEdgeId(selection.id)),
    );
    setSelection(null);
  }, [selection, model, editModel]);

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
            editModel(addState(model, name));
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

        <label className="file-button">
          Открыть
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = "";
            }}
          />
        </label>

        <button onClick={() => exportJson(model)}>Скачать JSON</button>
        <button
          onClick={() =>
            void exportSmv(model).catch((error) =>
              setNotice([
                error instanceof ApiError
                  ? error.errors.join("; ")
                  : String(error),
              ]),
            )
          }
          disabled={backend !== "up"}
        >
          Скачать SMV
        </button>

        <button
          className="primary"
          onClick={run}
          disabled={verification.status === "running" || backend !== "up"}
        >
          {verification.status === "running" ? "Проверяю…" : "Проверить"}
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

      <div
        className="canvas"
        data-dropping={dropping}
        onDragOver={(e) => {
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropping(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void importFile(file);
        }}
      >
        <KripkeGraph
          model={model}
          rankDir={rankDir}
          layoutNonce={layoutNonce}
          connectMode={connectMode}
          renamed={renamed}
          selectedId={selection?.id ?? null}
          trace={trace}
          traceStep={step}
          onSelect={onSelect}
          onAddTransition={onAddTransition}
        />
        {dropping && (
          <p className="drop-hint">Отпустите файл, чтобы открыть модель</p>
        )}
        {notice && (
          <div className="notice" role="alert">
            <ul className="problems">
              {notice.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <button onClick={() => setNotice(null)}>Понятно</button>
          </div>
        )}
        {connectMode && (
          <p className="hint">
            Потяните от края состояния к другому, чтобы создать переход.
          </p>
        )}
      </div>

      <aside className="side">
        <Results
          verification={verification}
          openVerdict={openVerdict}
          step={step}
          onOpenVerdict={setOpenVerdict}
          onStep={setStep}
        />
        <Inspector
          model={model}
          selection={selection}
          onChange={editModel}
          onSelect={setSelection}
          onRename={rename}
        />
      </aside>
    </div>
  );
}
