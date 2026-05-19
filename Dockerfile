# 多阶段构建 - 构建阶段
# 使用国内镜像源以避免网络问题
FROM node:20-alpine AS builder

# ✅ 安装 OpenSSL 和必要的构建工具（Prisma 需要）
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories && apk add --no-cache openssl openssl-dev libc6-compat python3 make g++

WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 复制 prisma schema（现在在 backend 目录下）
COPY prisma ./prisma/

# 安装依赖（包括devDependencies，因为需要prisma和typescript）
RUN npm ci --legacy-peer-deps

# 强制安装正确版本的 @prisma/client 和 prisma CLI（确保版本匹配）
# 这确保即使 package-lock.json 中有其他版本，也会安装正确的版本
RUN npm install @prisma/client@5.7.0 prisma@5.7.0 --save-dev --legacy-peer-deps --no-save

# 设置占位符 DATABASE_URL 环境变量（prisma generate 需要读取 schema 中的 env("DATABASE_URL")）
# prisma generate 不需要真实的数据库连接，只需要环境变量存在即可
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public"

# 生成 Prisma Client（为了 TypeScript 编译能通过）
# 验证必要文件存在，然后生成 Client
# 设置重试机制以处理网络问题
RUN echo "Current directory: $(pwd)" && \
    echo "Prisma schema exists: $(test -f ./prisma/schema.prisma && echo 'yes' || echo 'no')" && \
    echo "@prisma/client version: $(npm list @prisma/client 2>/dev/null | grep @prisma/client || echo 'not found')" && \
    echo "Prisma CLI version: $(./node_modules/.bin/prisma --version 2>/dev/null || echo 'not found')" && \
    echo "Prisma CLI available: $(test -f ./node_modules/.bin/prisma && echo 'yes' || echo 'no')" && \
    (./node_modules/.bin/prisma generate --schema=./prisma/schema.prisma || \
     (echo "First attempt failed, retrying..." && sleep 5 && ./node_modules/.bin/prisma generate --schema=./prisma/schema.prisma))

# 复制后端源代码
COPY . .

# 编译 seed.ts 文件（确保 seed.js 存在）
RUN echo "编译 seed.ts 文件..." && \
    if [ -f prisma/seed.ts ]; then \
      npx tsc prisma/seed.ts --outDir prisma --module commonjs --esModuleInterop --resolveJsonModule --skipLibCheck && \
      echo "✓ seed.ts 编译完成"; \
    else \
      echo "⚠️  prisma/seed.ts 不存在，跳过编译"; \
    fi

# 构建应用（添加错误处理和验证）
RUN echo "Starting build process..." && \
    echo "Current directory: $(pwd)" && \
    echo "Checking source files..." && \
    ls -la src/ | head -5 && \
    echo "Checking tsconfig files..." && \
    cat tsconfig.json | grep -E "(outDir|include|exclude)" && \
    cat tsconfig.build.json && \
    cat nest-cli.json && \
    echo "Running build command..." && \
    npm run build 2>&1 && \
    echo "Build command completed" && \
    echo "Checking if JS files were generated..." && \
    if [ -z "$(find dist -name '*.js' -type f 2>/dev/null | head -1)" ]; then \
      echo "WARNING: No JS files found after nest build, compiling with tsc directly..." && \
      rm -rf dist && \
      echo "Running tsc compilation (showing all output)..." && \
      npx tsc --project tsconfig.build.json 2>&1 && \
      TSC_EXIT=$? && \
      echo "Tsc exit code: $TSC_EXIT" && \
      if [ $TSC_EXIT -ne 0 ]; then \
        echo "ERROR: Tsc compilation failed with exit code $TSC_EXIT" && \
        exit 1; \
      fi && \
      echo "Checking if dist directory was created..." && \
      if [ ! -d dist ]; then \
        echo "ERROR: dist directory was not created!" && \
        echo "Listing all files in current directory:" && \
        ls -la . && \
        echo "Checking for TypeScript errors above..." && \
        exit 1; \
      fi && \
      echo "Dist directory created successfully" && \
      echo "Tsc compilation completed"; \
    fi && \
    echo "Checking dist directory structure..." && \
    if [ ! -d dist ]; then \
      echo "ERROR: dist directory does not exist after compilation!" && \
      echo "Checking current directory contents:" && \
      ls -la . && \
      echo "Checking for any compilation errors above..." && \
      exit 1; \
    fi && \
    find dist -type f -name "*.js" | head -10 && \
    ls -la dist/ && \
    MAIN_JS=$(find dist -name "main.js" -type f 2>/dev/null | head -1) && \
    if [ -z "$MAIN_JS" ] && [ -f dist/src/main.js ]; then \
      MAIN_JS="dist/src/main.js"; \
    fi && \
    if [ -z "$MAIN_JS" ]; then \
      echo "ERROR: main.js not found after build!"; \
      echo "Searching for main.js:"; \
      find . -name "main.js" -type f 2>/dev/null || echo "main.js not found anywhere"; \
      echo "Dist directory tree:"; \
      find dist -type f | head -30; \
      exit 1; \
    fi && \
    echo "✓ Build verification passed: main.js found at $MAIN_JS" && \
    ls -lh "$MAIN_JS"

# --- 生产阶段 ---
# 使用国内镜像源以避免网络问题
FROM node:20-alpine AS production

# ✅ 安装 OpenSSL（运行时也需要）
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories && apk add --no-cache openssl libc6-compat python3 make g++

WORKDIR /app

ENV NODE_ENV=production

# 复制 package 文件和 prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# 安装生产依赖
RUN npm ci --only=production --legacy-peer-deps && npm cache clean --force

# 安装 Prisma CLI（用于迁移和生成）
RUN npm install -g prisma@5.7.0

# 安装 ts-node（用于运行测试脚本）
RUN npm install -g ts-node@^10.9.2 typescript@^5.3.3

# 从构建阶段复制构建产物、脚本和配置文件
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# 验证构建产物已成功复制
RUN echo "Verifying build artifacts..." && \
    MAIN_JS=$(find dist -name "main.js" -type f 2>/dev/null | head -1) && \
    if [ -z "$MAIN_JS" ]; then \
      echo "ERROR: main.js not found after copy from builder stage!"; \
      echo "Dist directory contents:"; \
      ls -la dist/ || echo "Dist directory does not exist!"; \
      find dist -type f | head -20; \
      exit 1; \
    fi && \
    echo "✓ Build artifacts verification passed: main.js found at $MAIN_JS"

# 创建上传目录和日志目录
RUN mkdir -p uploads/avatars logs

# 暴露端口
EXPOSE 21101

# 启动应用（直接使用 CMD，依赖健康检查确保数据库就绪）
# 注意：由于使用了 depends_on 的 condition: service_healthy，数据库已经就绪
# prisma 会自动查找 ./prisma/schema.prisma
# 运行数据库迁移和种子数据初始化
# 种子数据初始化逻辑：
#   - 首次部署：自动检测新数据库并初始化种子数据
#   - 后续更新：检测到数据库已初始化，自动跳过（通过检查 admin 用户是否存在）
#   - 强制跳过：设置环境变量 SKIP_SEED=true
CMD ["sh", "-c", "echo '🔧 生成 Prisma Client...' && prisma generate && echo '📊 运行数据库迁移...' && prisma migrate deploy && echo '🌱 检查并初始化种子数据...' && (npx prisma db seed || echo '⚠️  种子数据初始化失败或已存在，继续启动服务...') && echo '🚀 启动应用...' && MAIN_JS=$(find dist -name 'main.js' -type f 2>/dev/null | head -1) && if [ -z \"$MAIN_JS\" ]; then echo '❌ 错误: 找不到 main.js 文件'; exit 1; fi && node \"$MAIN_JS\""]
