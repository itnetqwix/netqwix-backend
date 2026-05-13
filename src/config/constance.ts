export class CONSTANCE {
  public static readonly SUCCESS = "SUCCESS";
  public static readonly FAIL = "FAIL";
  public static readonly PENDING = "PENDING";
  public static readonly ERROR = "ERROR";
  public static readonly CODE = "CODE";
  public static readonly BAD_DATA = "BAD_DATA";

  public static readonly RES_CODE = {
    success: 200,
    error: {
      internalServerError: 500,
      badRequest: 400,
      unauthorized: 401,
      forbidden: 403,
      notFound: 404,
    },
  };
  public static supportedCurrencies = ["usd", "eur", "gbp"]; // Add more supported currencies as needed

  public static readonly SCHEDULING_SLOTS = {
    trainer_id: "",
    available_slots: [
      {
        day: "monday",
        slots: [],
      },
      {
        day: "tuesday",
        slots: [],
      },
      {
        day: "wednesday",
        slots: [],
      },
      {
        day: "thursday",
        slots: [],
      },
      {
        day: "friday",
        slots: [],
      },
    ],
  };

  public static readonly TRAINER_SEARCH_KEYS = ["fullname", "category"];
  public static readonly TRAINEE_SEARCH_KEYS = [
    "trainer.fullname",
    "trainer.category",
  ];
  public static readonly USERS_SEARCH_KEYS = ["fullname", "category"];
  public static readonly INSTANT_MEETING_TIME_FORMAT = "HH:mm";
  public static readonly TRAINER_FEE_USD = 10;
}

export enum BOOKED_SESSIONS_STATUS {
  BOOKED = "booked",
  confirm = "confirmed",
  cancel = "canceled",
  completed = "completed",
  upcoming = "upcoming",
}
export const timeRegex = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const TimeOffSetRegex = /\+\d+:\d+/; // Regular expression to match the time offset pattern
export const utcOffset = "+05:30"

export class EVENTS {
  public static readonly ON_CONNECT = "connected";
  public static readonly ON_DISCONNECT = "disconnecting";
  public static readonly ON_ERROR = "onSocketError";
  public static readonly JOIN_ROOM = "JOIN_ROOM";
  public static readonly DRAW = "DRAW";
  public static readonly EMIT_DRAWING_CORDS = "EMIT_DRAWING_CORDS";
  public static readonly EMIT_STOP_DRAWING = "EMIT_STOP_DRAWING";
  public static readonly STOP_DRAWING = "STOP_DRAWING";
  public static readonly MOUSE_DOWN = "MOUSE_DOWN";
  public static readonly MOUSE_MOVE = "MOUSE_MOVE";
  public static readonly MOUSE_UP = "MOUSE_UP";
  public static readonly MOUSE_OUT = "MOUSE_OUT";
  public static readonly EMIT_CLEAR_CANVAS = "EMIT_CLEAR_CANVAS";
  public static readonly ON_CLEAR_CANVAS = "ON_CLEAR_CANVAS";
  public static readonly EMIT_UNDO = "EMIT_UNDO";
  public static readonly ON_UNDO = "ON_UNDO";
  public static readonly ON_VIDEO_SELECT = "ON_VIDEO_SELECT";
  public static readonly CALL_END = "CALL_END";
  public static readonly ON_VIDEO_SHOW = "ON_VIDEO_SHOW";
  public static readonly TOGGLE_DRAWING_MODE = "TOGGLE_DRAWING_MODE";
  public static readonly TOGGLE_FULL_SCREEN = "TOGGLE_FULL_SCREEN";
  public static readonly TOGGLE_LOCK_MODE = "TOGGLE_LOCK_MODE";
  public static readonly ON_VIDEO_ZOOM_PAN = "ON_VIDEO_ZOOM_PAN";
  public static readonly ON_VIDEO_PLAY_PAUSE = "ON_VIDEO_PLAY_PAUSE";
  public static readonly ON_VIDEO_TIME = "ON_VIDEO_TIME";
  public static readonly VIDEO_CALL = {
    ON_OFFER: "offer",
    ON_SIGNAL: "signal",
    ON_ANSWER: "answer",
    ON_ICE_CANDIDATE: "ice-candidate",
    ON_STREAM: "stream",
    ON_CONNECT: "connect",
    ON_CLOSE: "close",
    MUTE_ME: "MUTE_ME",
    STOP_FEED: "STOP_FEED",
    ON_CALL_JOIN: "ON_CALL_JOIN",  
    ON_BOTH_JOIN: "ON_BOTH_JOIN",
    ON_CALL_LEAVE: "ON_CALL_LEAVE",

  };
  public static readonly PUSH_NOTIFICATIONS = {
    ON_SEND : 'send',
    ON_RECEIVE : 'receive'
  }
  public static readonly BOOKING = {
    CREATED: 'BOOKING_CREATED',
    STATUS_UPDATED: 'BOOKING_STATUS_UPDATED'
  }
  public static readonly INSTANT_LESSON = {
    REQUEST: 'INSTANT_LESSON_REQUEST',
    ACCEPT: 'INSTANT_LESSON_ACCEPT',
    DECLINE: 'INSTANT_LESSON_DECLINE',
    EXPIRE: 'INSTANT_LESSON_EXPIRE',
    CLIPS_SELECTED: 'INSTANT_LESSON_CLIPS_SELECTED',
    TRAINEE_CANCELLED: 'INSTANT_LESSON_TRAINEE_CANCELLED',
    SESSION_RECORDING: 'INSTANT_LESSON_SESSION_RECORDING',
  }

  /** Chat — must match `nq-mobile` ChatRoomScreen socket events. */
  public static readonly CHAT = {
    MESSAGE: "CHAT_MESSAGE",
    JOIN: "JOIN_CHAT",
    LEAVE: "LEAVE_CHAT",
  } as const;
  public static readonly LESSON_TIMER = {
    WARNING: 'LESSON_TIME_WARNING',
    ENDED: 'LESSON_TIME_ENDED',
    STARTED: 'TIMER_STARTED'
  }
}
export const MONGO_DATE_FORMAT = {
  YYYY_MM_DD: "YYYY-MM-DD",
};

export const SessionReminderMinutes = {
  FIFTEEN: 15,
  FIVE:5
};

export const mongodbDate = {
  timeStamp: "T00:00:00.000+00:00",
};
export const AccountType = {
  Trainer: "Trainer",
  Trainee: "Trainee",
};

export const Netquix = {
  NetQwixEmailLogo:
    "http://staging.netqwix.com/netqwix/static/media/logo1.208e84f15276975dbb33.png",
  resetPwdUrl: "http://staging.netqwix.com/netqwix/resetpassword",
  stagingAitaHome: "http://staging.netqwix.com/netqwix/home",
  stagingAitaTraineeHome:
    "http://staging.netqwix.com/netqwix/trainee-schedules",
  stagingAitaTrainerHome:
    "http://staging.netqwix.com/netqwix/trainer-schedules",
};

export const amountType = {
  USD: "$",
};

export const NetquixImage = {
  logo: "https://netquix-ui.vercel.app/assets/images/netquix_logo.png",
};

export const UPDATE_FIELDS = {
  user: [
    "fullname",
    "mobile_no",
    "profile_picture",
    "category",
    "wallet_amount",
    "extraInfo",
  ],
};
export const allowedImageExtensions = [".jpg", ".jpeg", ".png"];

export const MAX_FILE_SIZE_MB = 1024 * 2;

export const Message = {
  errors: {
    noFileUpload: "No file uploaded.",
    maxFileSizeMB: "File size exceeds the allowed limit (2MB).",
    allowedImageExtensions: "Only image files are allowed.",
  },
  internal: "Internal Server Error",
  notFoundData: "Data not found",
};
