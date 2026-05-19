import { PartialType } from '@nestjs/mapped-types';
import { CreateQuickReplyGroupDto } from './create-quick-reply-group.dto';

export class UpdateQuickReplyGroupDto extends PartialType(
  CreateQuickReplyGroupDto,
) {}
