// Explicit local aggregate input only. Never imports reports, activates rights, or contacts a database.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { TileSpotV1 } from "../src/tiles/dto.ts";
import { campaignProgress, campaignProgressMarkdown } from "../src/coverage/progress.ts";
const args=process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--spots" || args[2] !== "--out") throw new Error("campaign-progress --spots public-spots.json --out DIRECTORY");
const spots=z.array(TileSpotV1).parse(JSON.parse(readFileSync(args[1],"utf8")));
if (new Set(spots.map((s)=>s.id)).size !== spots.length) throw new Error("duplicate spot IDs would inflate campaign progress");
const report=campaignProgress(spots);
const out=resolve(args[3]); mkdirSync(out,{recursive:true});
writeFileSync(resolve(out,"progress.json"),JSON.stringify(report,null,2)+"\n");
writeFileSync(resolve(out,"progress.md"),campaignProgressMarkdown(report));
console.log(campaignProgressMarkdown(report));
