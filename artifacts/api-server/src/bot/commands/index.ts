import * as setupTicket from "./setup.js";
import * as ticketAdmin from "./ticket-admin.js";

export const commands = [
  { data: setupTicket.data, execute: setupTicket.execute },
  { data: ticketAdmin.data, execute: ticketAdmin.execute },
];
