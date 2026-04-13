import { IsArray, IsNotEmpty, IsString } from "class-validator";
import { model } from "../../../model";

export class updateSlotsModel extends model {
  @IsArray()
  available_slots: [];

  constructor(body: { available_slots: [] }) {
    super();
    const { available_slots } = body;
    this.available_slots = available_slots;
  }
}

export class updateProfileModal extends model {
  // @IsNotEmpty()
  // @IsString()
  about: string;

  // @IsNotEmpty()
  // @IsString()
  teaching_style: string;

  // @IsNotEmpty()
  // @IsString()
  credentials_and_affiliations: string;

  // @IsNotEmpty()
  // @IsString()
  curriculum: string;

  constructor(body) {
    super();
    const { about,
      teaching_style,
      credentials_and_affiliations,
      curriculum } = body;
    this.about=about || '';
    this.teaching_style = teaching_style || '';
    this.credentials_and_affiliations = credentials_and_affiliations || '';
    this.curriculum = curriculum || '';
  }
}
