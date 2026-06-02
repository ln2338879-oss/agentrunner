export interface OfficeFurniture {
  id: string;
  kind: "desk" | "table" | "board" | "rack" | "sofa" | "plant" | "screen" | "terminal" | "coffee" | "rug";
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OfficeRoom {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OfficeSceneDefinition {
  width: number;
  height: number;
  tile: number;
  rooms: OfficeRoom[];
  furniture: OfficeFurniture[];
  palette: Record<string, string>;
}

export const OFFICE_SCENE: OfficeSceneDefinition = {
  width: 960,
  height: 540,
  tile: 32,
  palette: {
    floor: "#142137",
    wall: "#263a58",
    grid: "rgba(255,255,255,.055)",
    desk: "#8b6b4a",
    deskTop: "#b98b5f",
    board: "#244d59",
    rack: "#222b3e",
    plant: "#70d68c",
    rug: "rgba(146,211,255,.13)",
  },
  rooms: [
    { id: "planning", label: "Planning Board", x: 36, y: 42, w: 246, h: 156 },
    { id: "review", label: "Review Gate", x: 324, y: 42, w: 246, h: 156 },
    { id: "designer", label: "Design Studio", x: 612, y: 42, w: 246, h: 156 },
    { id: "reception", label: "Discord Handoff", x: 36, y: 342, w: 246, h: 144 },
    { id: "builder", label: "Builder Desks", x: 324, y: 246, w: 246, h: 168 },
    { id: "factory", label: "Factory Bench", x: 612, y: 246, w: 246, h: 168 },
    { id: "attention", label: "Attention Queue", x: 324, y: 438, w: 246, h: 72 },
    { id: "done", label: "Done Shelf", x: 612, y: 438, w: 246, h: 72 },
  ],
  furniture: [
    { id: "planning-board", kind: "board", label: "Plan", x: 62, y: 64, w: 90, h: 34 },
    { id: "planning-table", kind: "table", label: "Roadmap", x: 70, y: 120, w: 150, h: 44 },
    { id: "review-gate", kind: "board", label: "Review", x: 350, y: 64, w: 110, h: 34 },
    { id: "review-sofa", kind: "sofa", label: "Read", x: 382, y: 130, w: 128, h: 36 },
    { id: "design-screen", kind: "screen", label: "Canvas", x: 640, y: 60, w: 92, h: 52 },
    { id: "design-rug", kind: "rug", label: "Art", x: 688, y: 132, w: 104, h: 42 },
    { id: "discord-counter", kind: "coffee", label: "Discord", x: 62, y: 372, w: 118, h: 40 },
    { id: "reception-plant", kind: "plant", label: "", x: 216, y: 360, w: 24, h: 42 },
    { id: "builder-desk-1", kind: "desk", label: "Build", x: 350, y: 278, w: 76, h: 44 },
    { id: "builder-desk-2", kind: "desk", label: "Patch", x: 462, y: 278, w: 76, h: 44 },
    { id: "builder-terminal", kind: "terminal", label: "CLI", x: 392, y: 348, w: 108, h: 34 },
    { id: "factory-bench", kind: "table", label: "Factory", x: 648, y: 280, w: 150, h: 48 },
    { id: "factory-rack", kind: "rack", label: "Assets", x: 810, y: 292, w: 28, h: 82 },
    { id: "attention-lamp", kind: "screen", label: "Alert", x: 360, y: 454, w: 64, h: 32 },
    { id: "done-shelf", kind: "rack", label: "Done", x: 642, y: 452, w: 150, h: 32 },
  ],
};
