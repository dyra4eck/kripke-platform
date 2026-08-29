import { useEffect, useMemo, useState } from "react";

import {
  IDENTIFIER,
  addPredicate,
  allPredicates,
  removePredicate,
  renameState,
  removeTransition,
  setSpecifications,
  toggleInitial,
  unreachable,
} from "./edit";
import { parseEdgeId } from "./KripkeGraph";
import type { KripkeModel } from "./types/kripke";

export type Selection =
  | { kind: "state"; id: string }
  | { kind: "transition"; id: string }
  | null;

interface Props {
  model: KripkeModel;
  selection: Selection;
  onChange: (next: KripkeModel) => void;
  onSelect: (selection: Selection) => void;
  /** Renames need the old name too, so the node can keep its position. */
  onRename: (from: string, to: string) => void;
}

export default function Inspector({
  model,
  selection,
  onChange,
  onSelect,
  onRename,
}: Props) {
  const state = selection?.kind === "state" ? selection.id : null;

  const entry = model.state_predicates.find((p) => p.state === state);
  const predicates = entry?.predicates ?? [];
  const isInitial = state !== null && model.initial_states.includes(state);
  const outgoing = model.transitions.filter(([f]) => f === state);
  const incoming = model.transitions.filter(([, t]) => t === state);

  const dead = useMemo(() => {
    const withOutgoing = new Set(model.transitions.map(([f]) => f));
    return model.states.filter((s) => !withOutgoing.has(s));
  }, [model]);
  const orphans = useMemo(() => unreachable(model), [model]);
  const vocabulary = useMemo(() => allPredicates(model), [model]);

  return (
    <>
      <section>
        <h2>Выбрано</h2>

        {selection === null && (
          <p className="empty">
            Нажмите на состояние или переход, чтобы изменить его.
          </p>
        )}

        {selection?.kind === "transition" && (
          <TransitionPanel
            id={selection.id}
            onRemove={() => {
              onChange(removeTransition(model, ...parseEdgeId(selection.id)));
              onSelect(null);
            }}
          />
        )}

        {state !== null && (
          <>
            <NameField
              key={state}
              value={state}
              taken={model.states}
              onCommit={(next) => {
                onChange(renameState(model, state, next));
                onRename(state, next);
              }}
            />

            <button
              className="wide"
              onClick={() => onChange(toggleInitial(model, state))}
            >
              {isInitial ? "Убрать из начальных" : "Сделать начальным"}
            </button>

            <h2 style={{ marginTop: 18 }}>Предикаты</h2>
            <div className="chips">
              {predicates.length === 0 && (
                <span className="empty">Пока ни одного</span>
              )}
              {predicates.map((p) => (
                <span className="chip" key={p}>
                  {p}
                  <button
                    className="chip-x"
                    aria-label={`Убрать ${p}`}
                    onClick={() => onChange(removePredicate(model, state, p))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <PredicateField
              vocabulary={vocabulary}
              existing={predicates}
              states={model.states}
              onAdd={(p) => onChange(addPredicate(model, state, p))}
            />

            <div className="rows" style={{ marginTop: 14 }}>
              <div className="row">
                <span>Входящих</span>
                <span>{incoming.length}</span>
              </div>
              <div className="row">
                <span>Исходящих</span>
                <span>{outgoing.map(([, t]) => t).join(", ") || "—"}</span>
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

        {dead.length > 0 && (
          <p className="warn">
            Без исходящих переходов: {dead.join(", ")}. Отношение переходов не
            тотально.
          </p>
        )}
        {orphans.length > 0 && (
          <p className="warn">
            Недостижимы из начального состояния: {orphans.join(", ")}.
          </p>
        )}
      </section>

      <Specifications
        value={model.specifications ?? []}
        onChange={(next) => onChange(setSpecifications(model, next))}
      />
    </>
  );
}

function TransitionPanel({ id, onRemove }: { id: string; onRemove: () => void }) {
  const [from, to] = parseEdgeId(id);
  return (
    <>
      <p className="name">
        {from} → {to}
      </p>
      <button className="wide" onClick={onRemove}>
        Удалить переход
      </button>
    </>
  );
}

/** Renames on Enter or blur; refuses names the schema would reject. */
function NameField({
  value,
  taken,
  onCommit,
}: {
  value: string;
  taken: string[];
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const problem =
    draft === value
      ? null
      : !IDENTIFIER.test(draft)
        ? "Только латиница, цифры и _ $ # -, начиная с буквы"
        : taken.includes(draft)
          ? "Такое состояние уже есть"
          : null;

  const commit = () => {
    if (problem || draft === value) setDraft(value);
    else onCommit(draft);
  };

  return (
    <>
      <input
        className="name-input"
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(value);
        }}
        aria-label="Имя состояния"
      />
      {problem && <p className="field-error">{problem}</p>}
    </>
  );
}

function PredicateField({
  vocabulary,
  existing,
  states,
  onAdd,
}: {
  vocabulary: string[];
  existing: string[];
  states: string[];
  onAdd: (predicate: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const problem = !draft
    ? null
    : !IDENTIFIER.test(draft)
      ? "Недопустимое имя"
      : states.includes(draft)
        ? "Уже используется как имя состояния"
        : existing.includes(draft)
          ? "Уже добавлен"
          : null;

  const submit = () => {
    if (!draft || problem) return;
    onAdd(draft);
    setDraft("");
  };

  return (
    <>
      <div className="field-row">
        <input
          list="predicate-vocabulary"
          value={draft}
          placeholder="Добавить предикат"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button onClick={submit} disabled={!draft || problem !== null}>
          +
        </button>
      </div>
      {/* Reusing a name already in the model is the common case, so offer
          the existing vocabulary rather than making the user retype it. */}
      <datalist id="predicate-vocabulary">
        {vocabulary.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      {problem && <p className="field-error">{problem}</p>}
    </>
  );
}

function Specifications({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const formula = draft.trim();
    if (!formula || value.includes(formula)) return;
    onChange([...value, formula]);
    setDraft("");
  };

  return (
    <section>
      <h2>Спецификации</h2>
      {value.length === 0 ? (
        <p className="empty">Пока ни одной. Например: AG !(p &amp; q)</p>
      ) : (
        <ul className="formulas">
          {value.map((f) => (
            <li key={f}>
              <span>{f}</span>
              <button
                className="chip-x"
                aria-label="Удалить спецификацию"
                onClick={() => onChange(value.filter((x) => x !== f))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="field-row" style={{ marginTop: 8 }}>
        <input
          value={draft}
          placeholder="AG (p -> AF q)"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button onClick={add} disabled={!draft.trim()}>
          +
        </button>
      </div>
    </section>
  );
}
