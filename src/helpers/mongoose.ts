import mongoose from "mongoose";

export const isValidMongoObjectId = (id: string): boolean => {
  const objectId = mongoose.Types.ObjectId;
  if (objectId.isValid(id)) {
    return new objectId(id).toString() === id;
  }
  return false;
};

export const getSearchRegexQuery = (search: string, searchKeys: string[]) => {
  const regex = { $regex: search, $options: "i" };
  const conditions = searchKeys.map((keys) => {
    return { [keys]: regex };
  });
  return {
    $or: conditions,
  };
};
