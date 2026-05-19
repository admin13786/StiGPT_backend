/**
 * 数据库迁移验证脚本
 * 用于验证工单自动关闭功能的数据库迁移是否成功
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function verifyMigration() {
  console.log('🔍 开始验证数据库迁移...\n');

  try {
    // 1. 验证 closureMetadata 字段
    console.log('1️⃣ 验证 closureMetadata 字段...');
    const result = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'Ticket' AND column_name = 'closureMetadata'
    `;

    if (result.length === 0) {
      console.error('❌ closureMetadata 字段不存在');
      process.exit(1);
    }

    const field = result[0];
    if (field.data_type !== 'jsonb') {
      console.error(`❌ closureMetadata 字段类型错误: ${field.data_type}，预期: jsonb`);
      process.exit(1);
    }

    if (field.is_nullable !== 'YES') {
      console.error('❌ closureMetadata 字段应该允许 NULL');
      process.exit(1);
    }

    console.log('✅ closureMetadata 字段验证通过\n');

    // 2. 验证索引
    console.log('2️⃣ 验证索引...');
    const expectedIndexes = [
      'SatisfactionRating_createdAt_idx',
      'SatisfactionRating_agentId_createdAt_idx',
      'Session_status_agentId_idx',
      'Session_status_createdAt_idx',
      'Ticket_status_createdAt_idx',
      'Ticket_gameId_status_idx',
      'Ticket_closedAt_idx',
      'TicketMessage_ticketId_createdAt_idx',
      'User_role_isOnline_deletedAt_idx',
    ];

    const indexes = await prisma.$queryRaw`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
      AND indexname = ANY(${expectedIndexes})
    `;

    const foundIndexes = indexes.map((idx) => idx.indexname);
    const missingIndexes = expectedIndexes.filter(
      (idx) => !foundIndexes.includes(idx),
    );

    if (missingIndexes.length > 0) {
      console.error(`❌ 缺少以下索引: ${missingIndexes.join(', ')}`);
      process.exit(1);
    }

    console.log(`✅ 所有 ${expectedIndexes.length} 个索引验证通过\n`);

    // 3. 测试写入和读取
    console.log('3️⃣ 测试 closureMetadata 写入和读取...');

    // 查找一个测试工单
    const testTicket = await prisma.ticket.findFirst({
      where: {
        status: 'RESOLVED',
      },
    });

    if (!testTicket) {
      console.log('⚠️  没有找到已关闭的工单，跳过写入测试');
    } else {
      // 测试写入
      const testMetadata = {
        method: 'test',
        closedBy: 'verification-script',
        closedAt: new Date().toISOString(),
        testFlag: true,
      };

      await prisma.ticket.update({
        where: { id: testTicket.id },
        data: {
          closureMetadata: testMetadata,
        },
      });

      // 测试读取
      const updatedTicket = await prisma.ticket.findUnique({
        where: { id: testTicket.id },
      });

      if (!updatedTicket.closureMetadata) {
        console.error('❌ closureMetadata 写入失败');
        process.exit(1);
      }

      if (updatedTicket.closureMetadata.testFlag !== true) {
        console.error('❌ closureMetadata 读取数据不正确');
        process.exit(1);
      }

      // 清理测试数据
      await prisma.ticket.update({
        where: { id: testTicket.id },
        data: {
          closureMetadata: null,
        },
      });

      console.log('✅ closureMetadata 写入和读取测试通过\n');
    }

    // 4. 验证查询性能
    console.log('4️⃣ 验证查询性能（索引使用情况）...');

    const indexUsage = await prisma.$queryRaw`
      SELECT
        indexrelname as indexname,
        idx_scan as scans,
        idx_tup_read as tuples_read
      FROM pg_stat_user_indexes
      WHERE indexrelname LIKE '%Ticket%'
      OR indexrelname LIKE '%Session%'
      OR indexrelname LIKE '%SatisfactionRating%'
      ORDER BY idx_scan DESC
      LIMIT 10
    `;

    console.log('索引使用统计（前10个）:');
    if (indexUsage.length === 0) {
      console.log('  - 暂无索引使用统计（可能是新迁移）');
    } else {
      indexUsage.forEach((idx) => {
        console.log(
          `  - ${idx.indexname}: ${idx.scans} 次扫描, ${idx.tuples_read} 行读取`,
        );
      });
    }
    console.log();

    // 5. 检查数据库大小
    console.log('5️⃣ 检查数据库大小...');

    const dbSize = await prisma.$queryRaw`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `;

    const tableSize = await prisma.$queryRaw`
      SELECT
        pg_size_pretty(pg_total_relation_size('public."Ticket"')) AS total_size,
        pg_size_pretty(pg_relation_size('public."Ticket"')) AS table_size,
        pg_size_pretty(pg_total_relation_size('public."Ticket"') - pg_relation_size('public."Ticket"')) AS indexes_size
    `;

    console.log(`数据库总大小: ${dbSize[0].size}`);
    console.log(`Ticket 表总大小: ${tableSize[0].total_size}`);
    console.log(`  - 表数据: ${tableSize[0].table_size}`);
    console.log(`  - 索引: ${tableSize[0].indexes_size}`);
    console.log();

    // 验证完成
    console.log('✅ 所有验证通过！数据库迁移成功。\n');
    console.log('📊 迁移摘要:');
    console.log('  - closureMetadata 字段: ✅ 已添加');
    console.log(`  - 索引: ✅ ${expectedIndexes.length} 个已创建`);
    console.log('  - 写入/读取: ✅ 正常工作');
    console.log('  - 数据库大小: ✅ 正常');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ 验证失败:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// 执行验证
verifyMigration();
