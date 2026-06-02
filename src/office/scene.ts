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
    floor: "#13223a",
    wall: "#263a58",
    grid: "rgba(255,255,255,.06)",
    desk: "#8b6b4a",
    deskTop: "#c39567",
    board: "#1f5360",
    rack: "#222b3e",
    plant: "#70d68c",
    rug: "rgba(146,211,255,.15)",
    glow: "rgba(146,211,255,.28)",
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
    { id: "planning-rug", kind: "rug", label: "", x: 56, y: 108, w: 188, h: 70 },
    { id: "planning-board", kind: "board", label: "Plan", x: 62, y: 64, w: 96, h: 38 },
    { id: "planning-table", kind: "table", label: "Roadmap", x: 72, y: 128, w: 150, h: 44 },
    { id: "planning-screen", kind: "screen", label: "Run", x: 188, y: 64, w: 58, h: 38 },
    { id: "review-rug", kind: "rug", label: "", x: 350, y: 118, w: 170, h: 56 },
    { id: "review-gate", kind: "board", label: "Review", x: 350, y: 64, w: 110, h: 34 },
    { id: "review-sofa", kind: "sofa", label: "Read", x: 382, y: 132, w: 128, h: 36 },
    { id: "review-plant", kind: "plant", label: "", x: 526, y: 124, w: 24, h: 42 },
    { id: "design-rug", kind: "rug", label: "Art", x: 654, y: 128, w: 150, h: 48 },
    { id: "design-screen", kind: "screen", label: "Canvas", x: 640, y: 60, w: 92, h: 52 },
    { id: "design-board", kind: "board", label: "Style", x: 752, y: 64, w: 70, h: 34 },
    { id: "design-plant", kind: "plant", label: "", x: 828, y: 124, w: 24, h: 42 },
    { id: "discord-rug", kind: "rug", label: "", x: 58, y: 360, w: 160, h: 84 },
    { id: "discord-counter", kind: "coffee", label: "Discord", x: 62, y: 372, w: 118, h: 40 },
    { id: "discord-screen", kind: "screen", label: "Thread", x: 92, y: 430, w: 92, h: 32 },
    { id: "reception-plant", kind: "plant", label: "", x: 216, y: 360, w: 24, h: 42 },
    { id: "builder-rug", kind: "rug", label: "", x: 350, y: 312, w: 172, h: 74 },
    { id: "builder-desk-1", kind: "desk", label: "Build", x: 350, y: 278, w: 76, h: 44 },
    { id: "builder-desk-2", kind: "desk", label: "Patch", x: 462, y: 278, w: 76, h: 44 },
    { id: "builder-terminal", kind: "terminal", label: "CLI", x: 392, y: 348, w: 108, h: 34 },
    { id: "builder-rack", kind: "rack", label: "Repo", x: 528, y: 328, w: 26, h: 60 },
    { id: "factory-rug", kind: "rug", label: "", x: 646, y: 318, w: 170, h: 58 },
    { id: "factory-bench", kind: "table", label: "Factory", x: 648, y: 280, w: 150, h: 48 },
    { id: "factory-screen", kind: "screen", label: "Batch", x: 684, y: 348, w: 98, h: 34 },
    { id: "factory-rack", kind: "rack", label: "Assets", x: 810, y: 292, w: 28, h: 82 },
    { id: "attention-rug", kind: "rug", label: "", x: 338, y: 450, w: 196, h: 44 },
    { id: "attention-lamp", kind: "screen", label: "Alert", x: 360, y: 454, w: 64, h: 32 },
    { id: "attention-table", kind: "table", label: "Needs You", x: 438, y: 454, w: 100, h: 32 },
    { id: "done-rug", kind: "rug", label: "", x: 632, y: 450, w: 196, h: 44 },
    { id: "done-shelf", kind: "rack", label: "Done", x: 642, y: 452, w: 150, h: 32 },
    { id: "done-plant", kind: "plant", label: "", x: 810, y: 450, w: 24, h: 42 },
  ],
};
