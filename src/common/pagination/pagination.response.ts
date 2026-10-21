import { ApiProperty } from '@nestjs/swagger';

export class PaginationResponse {
  @ApiProperty({ description: 'Cursor this page starts after', example: 0 })
  readonly after: number;

  @ApiProperty({ description: 'Maximum number of items per page', example: 50 })
  readonly limit: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Cursor to pass as `after` to fetch the next page, or null on the last page',
    example: 50,
  })
  readonly nextAfter: number | null;
}
