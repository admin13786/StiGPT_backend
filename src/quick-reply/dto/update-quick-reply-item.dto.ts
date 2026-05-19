import { PartialType } from '@nestjs/mapped-types';
import { CreateQuickReplyItemDto } from './create-quick-reply-item.dto';

export class UpdateQuickReplyItemDto extends PartialType(
  CreateQuickReplyItemDto,
) {}
