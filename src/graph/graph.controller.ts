import { Controller, Get, Param, Query } from '@nestjs/common';
import { SearchGraphDto } from './dto/search-graph.dto';
import { GraphService } from './graph.service';

@Controller('graph')
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  @Get('search')
  search(@Query() query: SearchGraphDto) {
    return this.graphService.search(query);
  }

  @Get('papers/:id')
  getPaper(@Param('id') id: string) {
    return this.graphService.getPaper(id);
  }

  @Get('papers/:id/relations')
  getPaperRelations(@Param('id') id: string) {
    return this.graphService.getPaperRelations(id);
  }

  @Get('papers/:id/references')
  getPaperReferences(@Param('id') id: string) {
    return this.graphService.getPaperReferences(id);
  }

  @Get('authors/:id')
  getAuthor(@Param('id') id: string) {
    return this.graphService.getAuthor(id);
  }

  @Get('authors/:id/collaborators')
  getAuthorCollaborators(@Param('id') id: string) {
    return this.graphService.getAuthorCollaborators(id);
  }

  @Get('institutions/:id')
  getInstitution(@Param('id') id: string) {
    return this.graphService.getInstitution(id);
  }

  @Get('institutions/:id/top-authors')
  getInstitutionTopAuthors(@Param('id') id: string) {
    return this.graphService.getInstitutionTopAuthors(id);
  }
}
