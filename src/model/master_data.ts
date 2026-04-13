import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

const masterDataSchema: Schema = new Schema({
  category: {
    type: [String],
    default: ['Golf', 'Tennis']
  },
});

const master_data = Model(Tables.master_data, masterDataSchema);
export default master_data;
