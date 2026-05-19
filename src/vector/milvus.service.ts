import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import * as net from 'node:net';

@Injectable()
export class MilvusService implements OnModuleInit {
  private readonly logger = new Logger(MilvusService.name);
  private client: MilvusClient;

  async onModuleInit() {
    try {
      const host = process.env.MILVUS_HOST;
      const port = process.env.MILVUS_PORT;
      
      if (!host || !port) {
        this.logger.warn('Milvus configuration not found, vector search will be disabled');
        return;
      }

      const portNumber = Number(port);
      const isReachable = await this.canConnect(host, portNumber);

      if (!isReachable) {
        this.logger.warn(
          `Milvus is not reachable at ${host}:${port}, vector search will be disabled`,
        );
        return;
      }

      this.client = new MilvusClient({
        address: `${host}:${port}`,
        username: process.env.MILVUS_USERNAME || '',
        password: process.env.MILVUS_PASSWORD || '',
      });
      this.logger.log('Milvus client initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Milvus client, vector search will be disabled', error);
      // 不抛出错误,允许应用继续运行
    }
  }

  async createCollection(kbId: string) {
    if (!this.client) {
      this.logger.warn('Milvus client not available, skipping collection creation');
      return null;
    }

    const collectionName = `kb_${kbId.replace(/-/g, '_')}`;
    
    try {
      const hasCollection = await this.client.hasCollection({
        collection_name: collectionName,
      });

      if (hasCollection.value) {
        this.logger.log(`Collection ${collectionName} already exists`);
        return collectionName;
      }

      // 创建集合
      await this.client.createCollection({
        collection_name: collectionName,
        fields: [
          {
            name: 'id',
            data_type: 5, // INT64
            is_primary_key: true,
            autoID: true,
          },
          {
            name: 'vector',
            data_type: 101, // FLOAT_VECTOR
            dim: parseInt(process.env.ALIYUN_EMBEDDING_DIMENSION || '1536'),
          },
          {
            name: 'chunk_id',
            data_type: 21, // VARCHAR
            max_length: 100,
          },
          {
            name: 'document_id',
            data_type: 21, // VARCHAR
            max_length: 100,
          },
          {
            name: 'content',
            data_type: 21, // VARCHAR
            max_length: 65535,
          },
        ],
      });

      this.logger.log(`Collection ${collectionName} created`);

      // 创建索引
      await this.client.createIndex({
        collection_name: collectionName,
        field_name: 'vector',
        index_type: 'IVF_FLAT',
        metric_type: 'COSINE',
        params: { nlist: 1024 },
      });

      this.logger.log(`Index created for ${collectionName}`);

      // 加载集合
      await this.client.loadCollection({
        collection_name: collectionName,
      });

      this.logger.log(`Collection ${collectionName} loaded`);

      return collectionName;
    } catch (error) {
      this.logger.error(`Failed to create collection ${collectionName}`, error);
      throw error;
    }
  }

  async insert(collectionName: string, data: any[]) {
    if (!this.client) {
      this.logger.warn('Milvus client not available, skipping insert');
      return [];
    }

    try {
      const result = await this.client.insert({
        collection_name: collectionName,
        data,
      });
      this.logger.log(`Inserted ${data.length} vectors into ${collectionName}`);
      // 处理不同类型的 ID 返回
      const ids = result.IDs;
      if ('int_id' in ids) {
        return ids.int_id.data;
      } else if ('str_id' in ids) {
        return ids.str_id.data;
      }
      return [];
    } catch (error) {
      this.logger.error(`Failed to insert vectors into ${collectionName}`, error);
      throw error;
    }
  }

  async search(collectionName: string, vectors: number[][], topK: number, filter?: string) {
    if (!this.client) {
      this.logger.warn('Milvus client not available, returning empty search results');
      return [];
    }

    try {
      const result = await this.client.search({
        collection_name: collectionName,
        vectors,
        vector_type: 101, // FloatVector
        search_params: {
          anns_field: 'vector',
          topk: topK,
          metric_type: 'COSINE',
          params: JSON.stringify({ nprobe: 10 }),
        },
        output_fields: ['chunk_id', 'document_id', 'content'],
        filter,
      });

      return result.results;
    } catch (error) {
      this.logger.error(`Failed to search in ${collectionName}`, error);
      throw error;
    }
  }

  async deleteByDocumentId(collectionName: string, documentId: string) {
    if (!this.client) {
      this.logger.warn('Milvus client not available, skipping delete');
      return;
    }

    try {
      await this.client.delete({
        collection_name: collectionName,
        filter: `document_id == "${documentId}"`,
      });
      this.logger.log(`Deleted vectors for document ${documentId} from ${collectionName}`);
    } catch (error) {
      this.logger.error(`Failed to delete vectors for document ${documentId}`, error);
      throw error;
    }
  }

  async deleteCollection(collectionName: string) {
    if (!this.client) {
      this.logger.warn('Milvus client not available, skipping collection deletion');
      return;
    }

    try {
      await this.client.dropCollection({
        collection_name: collectionName,
      });
      this.logger.log(`Collection ${collectionName} deleted`);
    } catch (error) {
      this.logger.error(`Failed to delete collection ${collectionName}`, error);
      throw error;
    }
  }

  getClient(): MilvusClient {
    return this.client;
  }

  private async canConnect(host: string, port: number, timeoutMs = 800): Promise<boolean> {
    if (!Number.isFinite(port) || port <= 0) {
      return false;
    }

    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      let settled = false;

      const finish = (result: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
  }
}
