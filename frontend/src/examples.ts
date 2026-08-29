// The repository's example models double as the editor's starting content.
// Imported from examples/ rather than copied, so there is one source.
import gbn from "../../examples/K_GBN_fixed.json";
import karn from "../../examples/K_Karn_v2.json";
import rto from "../../examples/K_RTO_v2.json";

import type { KripkeModel } from "./types/kripke";

// The schema types `states` as a non-empty tuple, which TypeScript cannot
// infer from a plain JSON import. These files are checked against the schema
// by CI, so the assertion is backed by the validate job rather than by hope.
const asModel = (json: unknown) => json as KripkeModel;

export const EXAMPLES: { id: string; label: string; model: KripkeModel }[] = [
  { id: "gbn", label: "K_GBN_fixed", model: asModel(gbn) },
  { id: "karn", label: "K_Karn_v2", model: asModel(karn) },
  { id: "rto", label: "K_RTO_v2", model: asModel(rto) },
];
