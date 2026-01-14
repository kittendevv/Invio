import { App, staticFiles } from "jsr:@fresh/core@^2.2.0";
import "./static/styles.css";

export const app = new App()
	.use(staticFiles())
	.fsRoutes();
