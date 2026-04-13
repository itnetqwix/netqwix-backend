import { BOOKED_SESSIONS_STATUS } from "../../config/constance";
import { model } from "../../model";
import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength, IsEnum, IsNumber, Min, Max, IsOptional } from 'class-validator';
export class signUpModel extends model {
    // checking validation
    @IsNotEmpty()
    @IsString()
    public username: string;

    @IsEmail()
    @IsNotEmpty()
    // @Validate(  )
    public email: string;

    @IsNotEmpty()
    @MinLength(10)
    @MaxLength(10)
    public number: number;

    @IsNotEmpty()
    @IsString()
    public password: number;

    constructor(body: any) {
        super();
        const { username, email, number, password } = body;
        this.username = username;
        this.email = email;
        this.password = password;
        this.number = number;
    }
}


export class updateBookedStatusModal extends model {
    // checking validation
    @IsNotEmpty()
    @IsString()
    @IsEnum(BOOKED_SESSIONS_STATUS)
    public booked_status: string;

    constructor(body) {
        super();
        const { booked_status } = body;
        this.booked_status = booked_status;
    }
}



export class updateRatings extends model {

    @IsNumber()
    @Min(0)
    @Max(5)
    public sessionRating: number;

    @IsNotEmpty()
    @IsNumber()
    @Min(0)
    @Max(5)
    public audioVideoRating: number;

    public recommendRating: number;

    @IsOptional()
    @IsString()
    public title: string;

    @IsOptional()
    @IsString()
    remarksInfo: string;


    @IsNotEmpty()
    public booking_id: string;

    constructor(body) {
        super();
        const { sessionRating, booking_id, audioVideoRating, recommendRating, title, remarksInfo } = body;
        this.sessionRating = sessionRating;
        this.audioVideoRating = audioVideoRating;
        this.recommendRating = recommendRating;
        this.title = title;
        this.remarksInfo = remarksInfo;
        this.booking_id = booking_id;
    }
}