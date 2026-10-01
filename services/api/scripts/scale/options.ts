import { PROFILES, type Profile } from "./corpus.ts";
export function scaleOptions(args: readonly string[]): { profile: Profile; output: string } {
  let profile: Profile = "small", output: string | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!["--profile", "--output"].includes(flag) || seen.has(flag) || !value || value.startsWith("--")) {
      throw new Error("usage: scale:community [--profile small|medium|large|stress] [--output file-prefix]");
    }
    seen.add(flag);
    if (flag === "--profile") {
      if (!Object.hasOwn(PROFILES,value)) throw new Error("--profile must be small, medium, large or stress");
      profile = value as Profile;
    } else output = value;
  }
  return { profile, output: output ?? `/private/tmp/mannerpath-scale-${profile}` };
}
