import { model } from "../../model";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class reportSessionBodyModal extends model {
  @IsNotEmpty()
  @IsString()
  public sessions: string;

  @IsNotEmpty()
  @IsString()
  public trainee: string;

  @IsOptional()
  @IsString()
  public title?: string;

  @IsOptional()
  @IsString()
  public description?: string;

  @IsOptional()
  public reportData?: unknown;

  constructor(body: Record<string, unknown>) {
    super();
    this.sessions = String(body.sessions ?? "");
    this.trainee = String(body.trainee ?? "");
    this.title = body.title != null ? String(body.title) : undefined;
    this.description =
      body.description != null ? String(body.description) : undefined;
    this.reportData = body.reportData;
  }
}

export class reportAddImageModal extends reportSessionBodyModal {
  constructor(body: Record<string, unknown>) {
    super(body);
  }
}

export class reportRemoveImageModal extends reportSessionBodyModal {
  @IsNotEmpty()
  @IsString()
  public filename: string;

  constructor(body: Record<string, unknown>) {
    super(body);
    this.filename = String(body.filename ?? body.oldFile ?? "");
  }
}

export class reportCropImageModal extends reportSessionBodyModal {
  @IsNotEmpty()
  @IsString()
  public oldFile: string;

  constructor(body: Record<string, unknown>) {
    super(body);
    this.oldFile = String(body.oldFile ?? "");
  }
}

export class reportSessionRecordingModal extends reportSessionBodyModal {
  @IsOptional()
  @IsString()
  public format?: string;

  constructor(body: Record<string, unknown>) {
    super(body);
    this.format = body.format != null ? String(body.format) : undefined;
  }
}

export class reportGetModal extends reportSessionBodyModal {
  constructor(body: Record<string, unknown>) {
    super(body);
  }
}
