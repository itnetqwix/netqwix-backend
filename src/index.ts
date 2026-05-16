import "./config/loadEnv";
import { assertJwtConfiguredAtStartup } from "./config/jwtSecret";
import { App } from "./app";

assertJwtConfiguredAtStartup();
new App();
