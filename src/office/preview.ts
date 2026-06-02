import { OFFICE_SCENE } from "./scene";

const ROLE_COLORS: Record<string, string> = {
  Director: "#ffd166",
  Builder: "#95d5ff",
  Factory: "#9ff0b6",
  Designer: "#ffb3d1",
  Reviewer: "#c7b5ff",
  Manager: "#f7d774",
};

export function renderOfficePreviewSvg(): string {
  const rooms = OFFICE_SCENE.rooms
    .map((room) => `<rect x="${room.x}" y="${room.y}" width="${room.w}" height="${room.h}" rx="10" fill="rgba(255,255,255,.045)" stroke="rgba(146,211,255,.42)"/><text x="${room.x + 10}" y="${room.y + 22}" fill="#eaf1ff" font-size="13" font-family="monospace">${escapeXml(room.label)}</text>`)
    .join("");
  const furniture = OFFICE_SCENE.furniture
    .map((item) => `<rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" rx="5" fill="${furnitureColor(item.kind)}" stroke="rgba(234,241,255,.26)"/><text x="${item.x + 5}" y="${item.y + item.h - 6}" fill="rgba(234,241,255,.72)" font-size="10" font-family="monospace">${escapeXml(item.label)}</text>`)
    .join("");
  const agents = [
    agent("Director", 96, 130),
    agent("Builder", 390, 344),
    agent("Factory", 680, 344),
    agent("Designer", 690, 130),
    agent("Reviewer", 390, 130),
    agent("Manager", 410, 474),
  ].join("");

  return svgWrap(`${floorPattern()}${rooms}${furniture}${agents}`);
}

export function renderAgentSheetPreviewSvg(): string {
  const agents = Object.keys(ROLE_COLORS)
    .map((name, index) => agentCard(name, 85 + index * 140, 160))
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="360" viewBox="0 0 960 360">
<rect width="960" height="360" fill="#07111f"/>
<rect x="20" y="20" width="920" height="320" rx="20" fill="#101a2a" stroke="#2a3e5c"/>
<text x="42" y="56" fill="#eaf1ff" font-size="24" font-family="system-ui, sans-serif" font-weight="700">AgentRunner Agent Characters</text>
${agents}
</svg>`;
}

function svgWrap(content: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
<defs><radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#92d3ff" stop-opacity="0.20"/><stop offset="1" stop-color="#92d3ff" stop-opacity="0"/></radialGradient></defs>
<rect width="960" height="540" fill="#13223a"/>
<circle cx="160" cy="120" r="155" fill="url(#glow)" opacity=".55"/>
<circle cx="730" cy="130" r="145" fill="#ffb3d1" opacity=".08"/>
${content}
<rect x="0" y="0" width="960" height="540" fill="none" stroke="rgba(146,211,255,.18)"/>
</svg>`;
}

function floorPattern(): string {
  const cells: string[] = [];
  for (let y = 0; y < 540; y += 32) {
    for (let x = 0; x < 960; x += 32) {
      cells.push(`<rect x="${x}" y="${y}" width="32" height="32" fill="${(x / 32 + y / 32) % 2 === 0 ? "rgba(255,255,255,.018)" : "rgba(0,0,0,.02)"}"/>`);
    }
  }
  return cells.join("");
}

function agent(name: string, x: number, y: number): string {
  const color = ROLE_COLORS[name] ?? "#95d5ff";
  return `<ellipse cx="${x}" cy="${y + 30}" rx="24" ry="7" fill="rgba(0,0,0,.35)"/><rect x="${x - 12}" y="${y - 30}" width="24" height="10" fill="#2a1d18"/><rect x="${x - 11}" y="${y - 22}" width="22" height="16" fill="#f7cfa2"/><rect x="${x - 17}" y="${y - 7}" width="34" height="30" fill="${color}"/><rect x="${x - 17}" y="${y + 3}" width="34" height="7" fill="#fff"/><rect x="${x - 13}" y="${y + 22}" width="9" height="14" fill="#1f3150"/><rect x="${x + 4}" y="${y + 22}" width="9" height="14" fill="#1f3150"/><text x="${x}" y="${y + 55}" fill="#eaf1ff" font-size="12" text-anchor="middle" font-family="monospace">${escapeXml(name)}</text>`;
}

function agentCard(name: string, x: number, y: number): string {
  return `<rect x="${x - 55}" y="${y - 78}" width="110" height="210" rx="14" fill="#162337" stroke="#2a3e5c"/>${agent(name, x, y)}<text x="${x}" y="${y + 94}" fill="#9fb0c8" font-size="12" text-anchor="middle" font-family="monospace">${escapeXml(name.toLowerCase())}</text>`;
}

function furnitureColor(kind: string): string {
  const colors: Record<string, string> = {
    desk: "#8b6b4a",
    table: "#73533d",
    board: "#1f5360",
    rack: "#222b3e",
    sofa: "#374464",
    plant: "#70d68c",
    screen: "#08111f",
    terminal: "#07111f",
    coffee: "#5e3d2b",
    rug: "rgba(146,211,255,.15)",
  };
  return colors[kind] ?? "#263a58";
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
