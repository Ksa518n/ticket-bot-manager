import * as setupTicket from "./setup.js";
import * as panel from "./panel.js";
import * as config from "./config.js";
import * as admin from "./admin.js";

export const commands = [
  { data: setupTicket.data, execute: setupTicket.execute },
  { data: panel.data, execute: panel.execute },
  { data: config.data, execute: config.execute },
  { data: admin.data, execute: admin.execute },
];
