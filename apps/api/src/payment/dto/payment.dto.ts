import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class CreateRechargeDto {
  @ApiProperty({ description: '充值金额（分，人民币），需不小于最小充值金额', example: 1000, minimum: 1 })
  @IsInt()
  @Min(1)
  amountCents!: number;
}