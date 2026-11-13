import { mkdir, copyFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pub = join(root, "public-build");
const previousPublic = join(root, "public");
const models = join(pub, "models");
const vendor = join(pub, "vendor");
await Promise.all([mkdir(models, { recursive: true }), mkdir(vendor, { recursive: true })]);

const assets = [
  ["https://github.com/yazinsai/tilawa/releases/download/zipformer-a0w-ep1-a0.5/zipformer_a0w_ep1_a05.int8.onnx", join(models, "zipformer_a0w_ep1_a05.int8.onnx"), 60_000_000],
  ["https://github.com/yazinsai/tilawa/releases/download/zipformer-a0w-ep1-a0.5/zipformer_a0w_ep1_a05.io.json", join(models, "zipformer_a0w_ep1_a05.io.json"), 10_000],
  ["https://github.com/yazinsai/tilawa/releases/download/v0.3.0/zipformer_quran.json", join(pub, "zipformer_quran.json"), 1_000_000],
  ["https://github.com/yazinsai/tilawa/releases/download/v0.2.0/quran.json", join(pub, "quran.json"), 1_000_000],
  ["https://github.com/yazinsai/tilawa/releases/download/zipformer-a0w-ep1-a0.5/NPL-1.2.txt", join(pub, "NPL-1.2.txt"), 1_000],
  ["https://raw.githubusercontent.com/yazinsai/tilawa/main/NOTICE.md", join(pub, "NOTICE.md"), 100],
];
for (const [url, destination, minimum] of assets) {
  let present = false;
  try { present = (await stat(destination)).size >= minimum; } catch { /* Check the prior local preparation cache. */ }
  if (!present) {
    const cachedFile = join(previousPublic, destination.slice(pub.length + 1));
    try { if ((await stat(cachedFile)).size >= minimum) { await copyFile(cachedFile, destination); present = true; } } catch { /* Fetch below on a clean build host. */ }
  }
  if (present) continue;
  console.log("Fetching recitation asset:", url);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw Error("Asset download failed (" + response.status + "): " + url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < minimum) throw Error("Asset is incomplete: " + url);
  await writeFile(destination, bytes);
}

await copyFile(join(root, "vendor", "adhan.umd.min.js"), join(vendor, "adhan.umd.min.js"));
await copyFile(join(root, "service-worker.js"), join(pub, "service-worker.js"));
await copyFile(join(root, "manifest.webmanifest"), join(pub, "manifest.webmanifest"));
await copyFile(join(root, "icon.svg"), join(pub, "icon.svg"));
console.log("Recitation assets prepared.");

