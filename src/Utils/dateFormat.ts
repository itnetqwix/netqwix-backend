import * as moment from "moment";

export class DateFormat {
  public static addMinutes(date: Date, minutes: number, format: string) {
    return moment(date).add(minutes, "minutes").format(format);
  }
}
