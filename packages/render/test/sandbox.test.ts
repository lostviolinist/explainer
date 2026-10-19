import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCode, MAX_ELEMENTS } from "../src/animator/three-server.ts";

const scene = (body: string, imports = 'import { Stage, Picture, Label } from "./Kit";') => `${imports}\nexport default function Scene() { return ${body}; }`;

test("motion scenes: the kit's rules are checked before anything runs", () => {
  assert.equal(checkCode(scene("<Stage><Picture at={0} /><Label x={900} y={300} at={1}>Air rises</Label></Stage>"), "motion", true), null);
  assert.match(checkCode(scene("<g />"), "motion", true)!, /<Stage>/);
  assert.match(checkCode(scene("<Stage />"), "motion", true)!, /<Picture>/, "a scene with a picture must place it");
  assert.equal(checkCode(scene("<Stage />"), "motion", false), null, "no picture, no obligation");
  assert.match(checkCode(scene("<Stage><Picture /><text>x</text></Stage>"), "motion", true)!, /SVG <text>/);
  assert.match(checkCode(scene("<Stage><Picture /></Stage>", 'import { Mesh } from "three";'), "motion", true)!, /not available/);
  const busy = Array.from({ length: MAX_ELEMENTS + 1 }, (_, i) => `<Label x={${i}} y={0}>${i}</Label>`).join("");
  assert.match(checkCode(scene(`<Stage><Picture />${busy}</Stage>`), "motion", true)!, /Too much on screen/);
  assert.match(checkCode(scene("<Stage />", 'import { Stage } from "./Kit"; const f = fetch("x");'), "motion", false)!, /not allowed/);
});

test("three scenes cannot import the flat kit, and vice versa", () => {
  assert.match(checkCode(scene("<Stage />"), "three")!, /not available/);
  assert.equal(checkCode('import { useFrame } from "@react-three/fiber";\nexport default function Scene() { return <mesh />; }', "three"), null);
});
