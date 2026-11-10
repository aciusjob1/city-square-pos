import { IsString, Length, Matches } from 'class-validator';

export class LoginPinDto {
  @IsString()
  @Length(4, 4)
  @Matches(/^[0-9]{4}$/, { message: 'PIN must be exactly 4 digits' })
  pin: string;
}
