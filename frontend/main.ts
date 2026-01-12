import { App, staticFiles } from "jsr:@fresh/core@^2.2.0";

export const app = new App({ root: import.meta.url })
	.use(staticFiles())
	.fsRoutes();
