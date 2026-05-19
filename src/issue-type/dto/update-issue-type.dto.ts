import { PartialType } from '@nestjs/mapped-types';
import { CreateIssueTypeDto } from './create-issue-type.dto';

export class UpdateIssueTypeDto extends PartialType(CreateIssueTypeDto) {}
