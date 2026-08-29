import { useEffect, useRef } from "react";
import cytoscape, { type ElementDefinition } from "cytoscape";
import dagre from "cytoscape-dagre";

import type { KripkeModel } from "./types/kripke";

cytoscape.use(dagre);

/**
 * A Kripke model as cytoscape elements.
 *
 * Initial states get an extra invisible node with an edge into them: that
 * incoming arrow is the standard automata notation for "start here", and it
 * reads faster than a colour change.
 */
export function toElements(model: KripkeModel): ElementDefinition[] {
  const initial = new Set<string>(model.initial_states);
  const predicates = new Map<string, string[]>(
    model.state_predicates.map((p) => [p.state, p.predicates]),
  );

  const elements: ElementDefinition[] = [];

  for (const id of model.states) {
    if (initial.has(id)) {
      elements.push({ data: { id: `__start_${id}` }, classes: "start-marker" });
    }
    elements.push({
      data: {
        id,
        label: id,
        predicates: predicates.get(id) ?? [],
        initial: initial.has(id),
      },
    });
  }

  for (const id of initial) {
    elements.push({
      data: { id: `__start_edge_${id}`, source: `__start_${id}`, target: id },
      classes: "start-marker",
    });
  }

  model.transitions.forEach(([from, to], i) => {
    elements.push({ data: { id: `e${i}`, source: from, target: to } });
  });

  return elements;
}

const style: cytoscape.StylesheetJson = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "font-family": "IBM Plex Mono, monospace",
      "font-size": 12,
      "font-weight": 500,
      "text-valign": "center",
      color: "#0f1720",
      "background-color": "#ffffff",
      "border-width": 1,
      "border-color": "#0f1720",
      shape: "round-rectangle",
      width: "label",
      height: 26,
      padding: "8px",
    },
  },
  {
    selector: "node[?initial]",
    style: { "border-width": 2, "border-color": "#1d4ed8" },
  },
  {
    selector: "node:selected",
    style: { "border-color": "#1d4ed8", "border-width": 3 },
  },
  {
    selector: "edge",
    style: {
      width: 1.2,
      "line-color": "#5c6b7a",
      "target-arrow-color": "#5c6b7a",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.9,
      "curve-style": "bezier",
    },
  },
  {
    // Self-loops collapse into the node without their own curve style.
    // @types/cytoscape predates the "loop" style, hence the cast.
    selector: "edge[source = target]",
    style: {
      "curve-style": "loop",
      "loop-direction": "0deg",
      "loop-sweep": "-40deg",
    } as unknown as cytoscape.Css.Edge,
  },
  {
    selector: ".start-marker",
    style: { width: 1, height: 1, "background-opacity": 0, label: "" },
  },
];

const LAYOUT = {
  name: "dagre",
  rankDir: "TB",
  nodeSep: 28,
  rankSep: 52,
  padding: 24,
  animate: false,
} as unknown as cytoscape.LayoutOptions;

interface Props {
  model: KripkeModel;
  onSelect: (stateId: string | null) => void;
}

export default function KripkeGraph({ model, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    if (!container.current) return;

    const instance = cytoscape({
      container: container.current,
      elements: toElements(model),
      style,
      wheelSensitivity: 0.2,
    });
    cy.current = instance;

    instance.layout(LAYOUT).run();
    instance.fit(undefined, 30);

    // Marker nodes are scaffolding, not part of the model.
    instance.on("tap", "node", (e) => {
      const id = e.target.id();
      onSelect(id.startsWith("__start_") ? null : id);
    });
    instance.on("tap", (e) => {
      if (e.target === instance) onSelect(null);
    });

    return () => {
      instance.destroy();
      cy.current = null;
    };
  }, [model, onSelect]);

  return <div ref={container} />;
}
