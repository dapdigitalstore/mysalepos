import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(191) username: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(191) password: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @MinLength(10) refreshToken: string;
}
