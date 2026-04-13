import { createLogger, format, transports } from 'winston';

const {
    combine, timestamp, prettyPrint, colorize
 } = format;

//  level: "debug",
//       transports: [new transports.Console()],
export class log {
    public static getLogger() {
       return createLogger({
           format: combine(
            //    timestamp({})
            prettyPrint(),
            colorize()
           ),
           level: "debug",
           transports: [new transports.Console() ]
       });
    }
}