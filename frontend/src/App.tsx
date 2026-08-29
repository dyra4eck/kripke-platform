import { useCallback, useEffect, useMemo, useState } from "react";

import KripkeGraph from "./KripkeGraph";
import { EXAMPLES } from "./examples";
import { health } from "./api";
import type { KripkeModel } from "./types/kripke";

export default function App() {
  const [exampleId, setExampleId] = useState(EXAMPLES[0].id);
  const [selected, setSelected] = useState<string | null>(null);
  const [backend, setBackend] = useState<"unknown" | "up" | "down">("unknown");

  const model: KripkeModel = useMemo(
    () => EXAMPLES.find((e) => e.id === exampleId)!.model,
    [exampleId],
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

  const onSelect = useCallback((id: string | null) => setSelected(id), []);

  const predicates =
    model.state_predicates.find((p) => p.state === selected)?.predicates ?? [];
  const isInitial = selected !== null && model.initial_states.includes(selected);
  const outgoing = model.transitions.filter(([from]) => from === selected);
  const incoming = model.transitions.filter(([, to]) => to === selected);

  return (
    <div className="app">
      <header className="bar">
        <h1>Kripke platform</h1>

        <label className="health" data-state={backend}>
          <select
            value={exampleId}
            onChange={(e) => {
              setExampleId(e.target.value);
              setSelected(null);
            }}
            aria-label="Модель"
          >
            {EXAMPLES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </label>

        <div className="spacer" />

        <span className="health" data-state={backend}>
          {backend === "up"
            ? "Сервер отвечает"
            : backend === "down"
              ? "Сервер недоступен"
              : "Проверяю связь"}
        </span>
      </header>

      <div className="canvas">
        <KripkeGraph model={model} onSelect={onSelect} />
      </div>

      <aside className="side">
        <section>
          <h2>Состояние</h2>
          {selected === null ? (
            <p className="empty">
              Выберите состояние на графе, чтобы увидеть его предикаты и
              переходы.
            </p>
          ) : (
            <>
              <p className="name">{selected}</p>
              <div className="chips">
                {isInitial && (
                  <span className="chip" data-role="initial">
                    начальное
                  </span>
                )}
                {predicates.length === 0 ? (
                  <span className="empty">Предикатов нет</span>
                ) : (
                  predicates.map((p) => (
                    <span className="chip" key={p}>
                      {p}
                    </span>
                  ))
                )}
              </div>
              <div className="rows" style={{ marginTop: 12 }}>
                <div className="row">
                  <span>Входящих</span>
                  <span>{incoming.length}</span>
                </div>
                <div className="row">
                  <span>Исходящих</span>
                  <span>{outgoing.map(([, to]) => to).join(", ") || "—"}</span>
                </div>
              </div>
            </>
          )}
        </section>

        <section>
          <h2>Модель</h2>
          <div className="rows">
            <div className="row">
              <span>Состояний</span>
              <span>{model.states.length}</span>
            </div>
            <div className="row">
              <span>Переходов</span>
              <span>{model.transitions.length}</span>
            </div>
            <div className="row">
              <span>Начальных</span>
              <span>{model.initial_states.join(", ")}</span>
            </div>
          </div>
        </section>

        <section>
          <h2>Спецификации</h2>
          {model.specifications?.length ? (
            <ul className="formulas">
              {model.specifications.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : (
            <p className="empty">Спецификаций нет.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
