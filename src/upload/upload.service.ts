import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException, ErrorCodes } from '../common/exceptions';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UploadService {
  private readonly uploadDir: string;

  constructor(private configService: ConfigService) {
    const configuredDir =
      this.configService.get<string>('UPLOAD_DIR') || 'uploads';
    this.uploadDir = path.isAbsolute(configuredDir)
      ? configuredDir
      : path.join(process.cwd(), configuredDir);

    this.ensureDirectoryExists(this.uploadDir);
  }

  private ensureDirectoryExists(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  private saveBufferToLocal(targetPath: string, buffer: Buffer) {
    const directory = path.dirname(targetPath);
    this.ensureDirectoryExists(directory);
    fs.writeFileSync(targetPath, buffer);
  }

  private buildFileResponse(
    relativePath: string,
    originalName: string,
    mimetype: string,
    size: number,
  ) {
    const normalizedPath = relativePath.replace(/\\/g, '/');
    const fileUrl = `/uploads/${normalizedPath}`;
    return {
      fileUrl,
      fileName: originalName,
      fileType: mimetype,
      fileSize: size,
    };
  }

  // 保存头像文件
  async saveAvatar(
    file: any,
    userId: string,
  ): Promise<{
    fileUrl: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  }> {
    // 验证文件类型（仅图片）
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BusinessException(
        ErrorCodes.FILE_TYPE_NOT_ALLOWED,
        '不支持的文件类型，仅支持 JPG、PNG、GIF、WEBP',
      );
    }

    // 验证文件大小（5MB）
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      throw new BusinessException(ErrorCodes.FILE_SIZE_EXCEEDED, '文件大小超过限制（5MB）');
    }

    // 生成唯一文件名
    const fileExt = path.extname(file.originalname);
    const fileName = `${uuidv4()}${fileExt}`;
    const relativePath = path.join('avatars', userId, fileName);
    const filePath = path.join(this.uploadDir, relativePath);

    this.saveBufferToLocal(filePath, file.buffer);
    return this.buildFileResponse(
      relativePath,
      file.originalname,
      file.mimetype,
      file.size,
    );
  }

  // 保存文件
  async saveFile(
    file: any,
    ticketId: string,
  ): Promise<{
    fileUrl: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  }> {
    // 验证文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BusinessException(
        ErrorCodes.FILE_TYPE_NOT_ALLOWED,
        '不支持的文件类型，仅支持 JPG、PNG、GIF、WEBP',
      );
    }

    // 验证文件大小（10MB）
    const maxSize = this.configService.get<number>('MAX_FILE_SIZE') || 10485760;
    if (file.size > maxSize) {
      throw new BusinessException(ErrorCodes.FILE_SIZE_EXCEEDED, '文件大小超过限制（10MB）');
    }

    // 生成唯一文件名
    const fileExt = path.extname(file.originalname);
    const fileName = `${uuidv4()}${fileExt}`;
    const relativePath = path.join(ticketId, fileName);
    const filePath = path.join(this.uploadDir, relativePath);

    this.saveBufferToLocal(filePath, file.buffer);
    return this.buildFileResponse(
      relativePath,
      file.originalname,
      file.mimetype,
      file.size,
    );
  }

  // 删除文件
  async deleteFile(fileUrl: string): Promise<void> {
    const relativePath = this.extractRelativePath(fileUrl);
    if (!relativePath) {
      return;
    }

    const filePath = path.join(this.uploadDir, relativePath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  private extractRelativePath(fileUrl: string): string | null {
    try {
      if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
        const parsed = new URL(fileUrl);
        return this.normalizeRelativePath(parsed.pathname);
      }
      return this.normalizeRelativePath(fileUrl);
    } catch (error) {
      return null;
    }
  }

  private normalizeRelativePath(pathname: string): string | null {
    if (!pathname) return null;
    if (pathname.startsWith('/uploads/')) {
      return pathname.replace('/uploads/', '');
    }
    return pathname.startsWith('/') ? pathname.substring(1) : pathname;
  }
}
