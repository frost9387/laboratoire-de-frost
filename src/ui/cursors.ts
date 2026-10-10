// Curseurs pixel du moodboard (flèche, main, sablier, réticule, loupe), dessinés au démarrage.
// Légende : X = noir, o = blanc, . = transparent.

const ARROW = [
  "X...........",
  "XX..........",
  "XoX.........",
  "XooX........",
  "XoooX.......",
  "XooooX......",
  "XoooooX.....",
  "XooooooX....",
  "XoooooooX...",
  "XooooooooX..",
  "XoooooXXXXX.",
  "XooXooX.....",
  "XoX.XooX....",
  "XX..XooX....",
  "X....XooX...",
  ".....XooX...",
  "......XX....",
];

const HAND = [
  "....XX..........",
  "...XooX.........",
  "...XooX.........",
  "...XooX.........",
  "...XooXXX.......",
  "...XooXooXXX....",
  "...XooXooXooXX..",
  "XX.XooXooXooXoX.",
  "XoXXooooooooXoX.",
  "XooXooooooooooX.",
  ".XoXoooooooooooX",
  ".XooooooooooooX.",
  "..XoooooooooooX.",
  "..XooooooooooX..",
  "...XoooooooooX..",
  "....XoooooooX...",
  "....XoooooooX...",
  "....XXXXXXXXX...",
];

const WAIT = [
  "XXXXXXXXXXXX",
  "XooooooooooX",
  ".XXXXXXXXXX.",
  ".XoooooooooX",
  ".XoXoXoXooX.",
  "..XoXoXoX...",
  "...XoXoX....",
  "....XoX.....",
  "....XoX.....",
  "...XoooX....",
  "..XooXooX...",
  ".XooXoXooX..",
  ".XoXoXoXoX..",
  "XXXXXXXXXXXX",
  "XooooooooooX",
  "XXXXXXXXXXXX",
];

const CROSS = [
  ".......X.......",
  ".......X.......",
  ".......X.......",
  ".......X.......",
  ".......X.......",
  "...............",
  ".......o.......",
  "XXXXX.oXo.XXXXX",
  ".......o.......",
  "...............",
  ".......X.......",
  ".......X.......",
  ".......X.......",
  ".......X.......",
  ".......X.......",
];

const ZOOM = [
  "...XXXX.......",
  ".XXooooXX.....",
  ".XoooXoooX....",
  "XoooXXXooX....",
  "XooXXXXXoX....",
  "XoooXXXooX....",
  ".XoooXoooX....",
  ".XXooooXX.....",
  "...XXXXXXX....",
  ".......XXXX...",
  "........XXXX..",
  ".........XXXX.",
  "..........XXX.",
];

function draw(map: string[], scale: number): string {
  const w = map[0].length;
  const hgt = map.length;
  const c = document.createElement("canvas");
  c.width = w * scale;
  c.height = hgt * scale;
  const g = c.getContext("2d")!;
  for (let y = 0; y < hgt; y++)
    for (let x = 0; x < w; x++) {
      const ch = map[y][x];
      if (ch === ".") continue;
      g.fillStyle = ch === "X" ? "#000" : "#fff";
      g.fillRect(x * scale, y * scale, scale, scale);
    }
  return c.toDataURL("image/png");
}

export function installCursors() {
  // le navigateur met déjà le curseur à l'échelle de l'écran : on dessine à 1:1
  const s = 1;
  const css = (map: string[], hx: number, hy: number, fallback: string) =>
    `url(${draw(map, s)}) ${hx * s} ${hy * s}, ${fallback}`;
  const root = document.documentElement.style;
  root.setProperty("--cur-arrow", css(ARROW, 0, 0, "default"));
  root.setProperty("--cur-hand", css(HAND, 5, 0, "pointer"));
  root.setProperty("--cur-wait", css(WAIT, 6, 8, "wait"));
  root.setProperty("--cur-cross", css(CROSS, 7, 7, "crosshair"));
  root.setProperty("--cur-zoom", css(ZOOM, 5, 5, "zoom-in"));
}
