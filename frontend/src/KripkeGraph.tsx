import { useEffect, useRef } from "react";
import cytoscape, { type ElementDefinition } from "cytoscape";
import dagre from "cytoscape-dagre";
import edgehandles from "cytoscape-edgehandles";

import type { KripkeModel } from "./types/kripke";

cytoscape.use(dagre);
cytoscape.use(edgehandles);

const START = "__start_";
/** Scratch elements owned by the edgehandles extension, not by the model. */
const EXTENSION_ELEMENTS = ".eh-handle, .eh-ghost-edge, .eh-preview, .eh-ghost-node";
const isMarker = (id: string) => id.startsWith(START);

/** Deterministic edge ids let the sync below diff by identity. */
export const edgeId = (from: string, to: string) => `e:${from}->${to}`;
export const parseEdgeId = (id: string): [string, string] =>
  id.slice(2).split("->") as [string, string];

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
      elements.push({ data: { id: `${START}${id}` }, classes: "start-marker" });
    }
    elements.push({
      data: {
        id,
        label: id,
        predicates: predicates.get(id) ?? [],
        initial: initial.has(id) ? 1 : 0,
      },
    });
  }

  for (const id of initial) {
    elements.push({
      data: { id: `${START}edge_${id}`, source: `${START}${id}`, target: id },
      classes: "start-marker",
    });
  }

  for (const [from, to] of model.transitions) {
    elements.push({
      data: { id: edgeId(from, to), source: from, target: to },
      // `edge[source = target]` is not a valid selector -- source and target
      // are not data fields -- so mark self-loops here instead.
      classes: from === to ? "self-loop" : undefined,
    });
  }

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
      // "auto" over the documented "label": with `width: label` a rebuild
      // leaves the canvas blank in this build, while "auto" sizes nodes to
      // their labels and only logs a cosmetic warning.
      width: "auto",
      height: 26,
      padding: "8px",
    },
  },
  {
    selector: "node[initial = 1]",
    style: { "border-width": 2, "border-color": "#1d4ed8" },
  },
  {
    // A state with no successor breaks totality; flag it on the canvas
    // instead of waiting for the server to reject the model.
    selector: "node.dead-end",
    style: { "border-color": "#b3261e", "border-style": "dashed" },
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
    selector: "edge:selected",
    style: {
      "line-color": "#1d4ed8",
      "target-arrow-color": "#1d4ed8",
      width: 2.5,
    },
  },
  {
    // Self-loops are drawn as arcs by default; these only aim them so they
    // do not sit on top of the node's label.
    selector: "edge.self-loop",
    style: { "loop-direction": "0deg", "loop-sweep": "-40deg" },
  },
  {
    selector: ".start-marker",
    style: { width: 1, height: 1, "background-opacity": 0, label: "" },
  },
  {
    selector: ".eh-handle",
    style: {
      "background-color": "#1d4ed8",
      width: 10,
      height: 10,
      "border-width": 6,
      "border-opacity": 0,
    },
  },
  {
    selector: ".eh-ghost-edge, .eh-preview",
    style: { "line-color": "#1d4ed8", "target-arrow-color": "#1d4ed8" },
  },
];

const layoutOptions = (rankDir: "LR" | "TB") =>
  ({
    name: "dagre",
    rankDir,
    nodeSep: 26,
    rankSep: 60,
    padding: 24,
    animate: false,
  }) as unknown as cytoscape.LayoutOptions;

interface Props {
  model: KripkeModel;
  rankDir: "LR" | "TB";
  /** Bump to re-run the layout; editing the model alone must not move nodes. */
  layoutNonce: number;
  connectMode: boolean;
  /** Set for the render right after a rename, so the node keeps its place. */
  renamed: { from: string; to: string } | null;
  /** Kept in sync so the highlight survives a rebuild. */
  selectedId: string | null;
  onSelect: (id: string | null, kind: "state" | "transition" | null) => void;
  onAddTransition: (from: string, to: string) => void;
}

export default function KripkeGraph({
  model,
  rankDir,
  layoutNonce,
  connectMode,
  renamed,
  selectedId,
  onSelect,
  onAddTransition,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<cytoscape.Core | null>(null);
  const eh = useRef<ReturnType<cytoscape.Core["edgehandles"]> | null>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  // Callbacks live in a ref so the instance is built once, not per render.
  const handlers = useRef({ onSelect, onAddTransition });
  handlers.current = { onSelect, onAddTransition };

  useEffect(() => {
    if (!container.current) return;

    const instance = cytoscape({
      container: container.current,
      style,
      wheelSensitivity: 0.2,
      minZoom: 0.2,
      maxZoom: 3,
    });
    cy.current = instance;

    eh.current = instance.edgehandles({
      canConnect: (source, target) =>
        !source.hasClass("start-marker") && !target.hasClass("start-marker"),
      edgeParams: () => ({ data: {} }),
    });
    eh.current.disableDrawMode();

    instance.on("tap", (e) => {
      if (e.target === instance) handlers.current.onSelect(null, null);
    });
    instance.on("tap", "node", (e) => {
      const id = e.target.id();
      if (isMarker(id)) handlers.current.onSelect(null, null);
      else handlers.current.onSelect(id, "state");
    });
    instance.on("tap", "edge", (e) => {
      const id = e.target.id();
      if (isMarker(id)) handlers.current.onSelect(null, null);
      else handlers.current.onSelect(id, "transition");
    });

    // edgehandles adds its own edge; the model is the source of truth, so
    // drop it and let the sync below re-add one with a deterministic id.
    instance.on("ehcomplete", (_e, source, target, added) => {
      added.remove();
      const from = source.id();
      const to = target.id();
      if (!isMarker(from) && !isMarker(to)) {
        handlers.current.onAddTransition(from, to);
      }
    });

    return () => {
      instance.destroy();
      cy.current = null;
      eh.current = null;
    };
  }, []);

  // Rebuild rather than diff. Cytoscape only guarantees a redraw for a full
  // replacement; incremental add/remove left renamed nodes invisible until
  // some unrelated change forced the canvas to repaint. Positions are kept in
  // a ref and restored, so nothing the user dragged moves.
  useEffect(() => {
    const instance = cy.current;
    if (!instance) return;

    for (const node of instance.nodes()) {
      positions.current.set(node.id(), { ...node.position() });
    }
    // A rename is a remove plus an add here, so hand the place over.
    if (renamed) {
      const previous = positions.current.get(renamed.from);
      if (previous) positions.current.set(renamed.to, previous);
    }

    const extent = instance.extent();
    const centre = {
      x: (extent.x1 + extent.x2) / 2,
      y: (extent.y1 + extent.y2) / 2,
    };
    let offset = 0;

    const elements = toElements(model).map((el) => {
      if (el.data.source !== undefined) return el; // edges follow their nodes
      const id = String(el.data.id);
      if (isMarker(id)) return el;
      const known = positions.current.get(id);
      if (known) return { ...el, position: { ...known } };
      // New states land in the middle of the viewport; the origin is usually
      // off-screen, and stacking them makes several additions unusable.
      const position = { x: centre.x + offset, y: centre.y + offset };
      offset += 24;
      return { ...el, position };
    });

    // edgehandles keeps its own handle and ghost elements in the graph.
    // Sweeping them away breaks the extension, which then throws and leaves
    // the canvas empty, so take out only what the model owns.
    instance.elements().not(EXTENSION_ELEMENTS).remove();
    try {
      instance.add(elements);
    } catch (error) {
      // A throw here leaves a half-empty canvas, which is hard to diagnose
      // from the outside; make it loud instead.
      console.error("Не удалось перестроить граф", error);
    }

    // Markers have no meaningful place of their own; park each one just
    // upstream of the state it points at.
    for (const id of model.initial_states) {
      const marker = instance.getElementById(`${START}${id}`);
      const target = instance.getElementById(id);
      if (marker.empty() || target.empty()) continue;
      const at = target.position();
      marker.position(
        rankDir === "LR" ? { x: at.x - 70, y: at.y } : { x: at.x, y: at.y - 60 },
      );
    }

    const withOutgoing = new Set(model.transitions.map(([f]) => f));
    for (const id of model.states) {
      instance.getElementById(id).toggleClass("dead-end", !withOutgoing.has(id));
    }

  }, [model, rankDir, renamed]);

  // Selection is view state, not model data. Rebuilding the graph for it
  // would tear the elements out from under the tap that caused it.
  useEffect(() => {
    const instance = cy.current;
    if (!instance) return;
    instance.elements(":selected").unselect();
    if (selectedId) instance.getElementById(selectedId).select();
  }, [selectedId, model]);

  useEffect(() => {
    const instance = cy.current;
    if (!instance) return;
    const layout = instance.layout(layoutOptions(rankDir));
    // fit() before the layout settles measures stale positions, so wait.
    layout.one("layoutstop", () => {
      instance.fit(undefined, 30);
      // Fitting a long chain zooms out until the labels are unreadable; past
      // this point the user is better served by panning.
      if (instance.zoom() < 0.55) {
        instance.zoom(0.55);
        instance.center();
      }
    });
    layout.run();
  }, [rankDir, layoutNonce]);

  useEffect(() => {
    if (!eh.current) return;
    if (connectMode) eh.current.enableDrawMode();
    else eh.current.disableDrawMode();
  }, [connectMode]);

  return <div ref={container} />;
}
