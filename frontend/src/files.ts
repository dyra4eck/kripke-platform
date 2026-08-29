import { convertRaw } from "./api";
import type { KripkeModel } from "./types/kripke";
import { validateModel } from "./validate";

export class ImportError extends Error {
  constructor(readonly problems: string[]) {
    super(problems[0] ?? "Не удалось прочитать файл");
    this.name = "ImportError";
  }
}

/**
 * Reads a .json file into a model, refusing anything the backend would
 * reject anyway. Validating here means the user sees the problem next to
 * the file they dropped, not as a 422 three clicks later.
 */
export async function readModelFile(file: File): Promise<KripkeModel> {
  if (file.size > 2_000_000) {
    throw new ImportError(["Файл больше 2 МБ — вряд ли это модель Крипке"]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    throw new ImportError([
      `${file.name}: не удалось разобрать JSON — ${
        error instanceof Error ? error.message : String(error)
      }`,
    ]);
  }

  const problems = validateModel(parsed);
  if (problems.length) throw new ImportError(problems);
  return parsed as KripkeModel;
}

function save(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportJson(model: KripkeModel, name = "model.json") {
  save(name, JSON.stringify(model, null, 2) + "\n", "application/json");
}

/**
 * The SMV comes from the server: generating it in the browser would mean a
 * second implementation of the converter, and the two would drift.
 */
export async function exportSmv(model: KripkeModel, name = "model.smv") {
  save(name, await convertRaw(model), "text/plain;charset=utf-8");
}
