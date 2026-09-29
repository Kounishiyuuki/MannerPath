import { app } from "./app.ts";
import { scheduled } from "./refresh/scheduled.ts";

export default { fetch: app.fetch, scheduled };
