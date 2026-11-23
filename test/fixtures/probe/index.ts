// A probe for check's warnings (test/check.test.mjs): an act point in reach, one in the air, a node the near look
// has and one it has not, a texture it loads, a panel the host refuses, one it takes but for a key cap.
import * as fc from "../../../assembly/fc";
export { fc_alloc } from "../../../assembly/fc";

export function fc_init(seed: i32): void {
  fc.act(`{"x":0,"y":0.5,"z":6,"r":2,"dy":1.5,"hint":{"zh":"近","en":"near"}}`);
  fc.act(`{"x":0,"y":6,"z":-6,"r":1,"dy":0.5,"hint":{"zh":"空中","en":"in the air"}}`);
  fc.nodeVisible("deck", true);
  fc.nodeVisible("lantern", false);
  fc.texture("tex.png");
  fc.panel(`{"title":{"zh":"测","en":"Probe"},"items":[{"label":{"zh":"a","en":"a"}}]`);
  fc.panel(`{"title":{"zh":"测","en":"Probe"},"items":[{"leave":{"key":"Esc","text":{"zh":"离开","en":"Leave"}}}]}`);
}

export function fc_tick(inbox: usize, len: i32): void {
  fc.sleep(1, 0);
}
