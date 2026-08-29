import type { PipelineResult, TraceState, Verdict } from "./api";

export interface Verification {
  status: "idle" | "running" | "done" | "failed";
  result: PipelineResult | null;
  errors: string[];
}

interface Props {
  verification: Verification;
  /** Index into check.verdicts, or null when no trace is being replayed. */
  openVerdict: number | null;
  step: number;
  onOpenVerdict: (index: number | null) => void;
  onStep: (step: number) => void;
}

export default function Results({
  verification,
  openVerdict,
  step,
  onOpenVerdict,
  onStep,
}: Props) {
  const { status, result, errors } = verification;

  if (status === "idle") {
    return (
      <section>
        <h2>Проверка</h2>
        <p className="empty">
          Нажмите «Проверить», чтобы прогнать модель через nuXmv.
        </p>
      </section>
    );
  }

  if (status === "running") {
    return (
      <section>
        <h2>Проверка</h2>
        <p className="empty">Считаю…</p>
      </section>
    );
  }

  if (status === "failed") {
    return (
      <section>
        <h2>Проверка</h2>
        <ul className="problems">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </section>
    );
  }

  const check = result?.check;
  if (!check) {
    return (
      <section>
        <h2>Проверка</h2>
        <p className="empty">
          SMV сгенерирован, спецификаций для проверки нет.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2>Проверка</h2>

      <p className={check.all_hold ? "verdict-ok" : "verdict-bad"}>
        {check.all_hold
          ? `Все ${check.verdicts.length} спецификаций выполняются`
          : `Не выполняется: ${check.verdicts.filter((v) => !v.holds).length} из ${check.verdicts.length}`}
        <span className="timing"> · {result.duration_s} с</span>
      </p>

      <ul className="verdicts">
        {check.verdicts.map((verdict, index) => (
          <VerdictRow
            key={verdict.formula}
            verdict={verdict}
            open={openVerdict === index}
            onToggle={() => {
              onOpenVerdict(openVerdict === index ? null : index);
              onStep(0);
            }}
          />
        ))}
      </ul>

      {openVerdict !== null && check.verdicts[openVerdict]?.trace.length > 0 && (
        <TracePlayer
          trace={check.verdicts[openVerdict].trace}
          step={step}
          onStep={onStep}
        />
      )}
    </section>
  );
}

function VerdictRow({
  verdict,
  open,
  onToggle,
}: {
  verdict: Verdict;
  open: boolean;
  onToggle: () => void;
}) {
  const replayable = !verdict.holds && verdict.trace.length > 0;
  return (
    <li className={verdict.holds ? "holds" : "violated"} data-open={open}>
      <button
        className="verdict-button"
        onClick={replayable ? onToggle : undefined}
        disabled={!replayable}
        title={replayable ? "Показать контрпример" : undefined}
      >
        <span aria-hidden>{verdict.holds ? "✓" : "✗"}</span>
        <code>{verdict.formula}</code>
      </button>
    </li>
  );
}

/**
 * Walks the counterexample one state at a time. The graph highlights the
 * current state; this shows which propositions hold there, since that is
 * what explains why the specification fails.
 */
function TracePlayer({
  trace,
  step,
  onStep,
}: {
  trace: TraceState[];
  step: number;
  onStep: (step: number) => void;
}) {
  const current = trace[Math.min(step, trace.length - 1)];
  const holding = Object.entries(current.values).filter(
    ([name, value]) => value === true && name !== "state_",
  );

  return (
    <div className="trace">
      <div className="trace-bar">
        <button onClick={() => onStep(Math.max(0, step - 1))} disabled={step === 0}>
          ←
        </button>
        <span className="trace-position">
          шаг {step + 1} из {trace.length}
          {current.loop_start && <em> · начало петли</em>}
        </span>
        <button
          onClick={() => onStep(Math.min(trace.length - 1, step + 1))}
          disabled={step >= trace.length - 1}
        >
          →
        </button>
      </div>

      <p className="name">{current.state ?? "—"}</p>
      <div className="chips">
        {holding.length === 0 ? (
          <span className="empty">Здесь не выполняется ни один предикат</span>
        ) : (
          holding.map(([name]) => (
            <span className="chip" key={name}>
              {name}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
