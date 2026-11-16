// main.ts — DUSTLINE entry program (Node 22 stdlib only).
// Copies game/ and screenshots/ from this repository into MAKEFUN_OUTPUT_DIR
// (else /output), then writes /output/dossier.json with buildDossier.
// Deterministic: same input files -> same output bytes.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

mkdirSync(outDir, { recursive: true });
for (const name of ['game', 'screenshots']) {
  const src = join(repoRoot, name);
  const dst = join(outDir, name);
  if (!existsSync(src)) continue;
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
}

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
