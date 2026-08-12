import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Min } from 'class-validator';

export class CreateRechargeDto {
  @ApiProperty({ description: '充值金额（分，人民币），需不小于最小充值金额', example: 1000, minimum: 1 })
  @IsInt()
  @Min(1)
  amountCents!: number;
}

export class CreatePlanOrderDto {
  @ApiProperty({ description: '要购买的 Plan id', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  @IsUUID()
  planId!: string;
}