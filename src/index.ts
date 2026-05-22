import "./config/loadEnv";
import { initSentry } from "./bootstrap/sentry";
import { assertJwtConfiguredAtStartup } from "./config/jwtSecret";
import { App } from "./app";

initSentry();
assertJwtConfiguredAtStartup();
new App();
