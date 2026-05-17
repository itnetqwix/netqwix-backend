import { model as Model, Schema } from "mongoose";
import { Tables } from "../config/tables";

const masterDataSchema: Schema = new Schema({
  category: {
    type: [String],
    default: ['Golf', 'Tennis']
  },
  /** Rotating sports tips for mobile/web loaders (admin-updatable). */
  loader_tips: {
    type: [String],
    default: [],
  },
});

const master_data = Model(Tables.master_data, masterDataSchema);
export default master_data;
