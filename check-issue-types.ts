import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('正在查询数据库中的问题类型...\n');
  
  const issueTypes = await prisma.issueType.findMany({
    where: {
      deletedAt: null,
    },
    orderBy: {
      sortOrder: 'asc',
    },
  });

  console.log(`找到 ${issueTypes.length} 个问题类型：\n`);
  
  issueTypes.forEach((type, index) => {
    console.log(`${index + 1}. ${type.name}`);
    console.log(`   ID: ${type.id}`);
    console.log(`   启用: ${type.enabled ? '是' : '否'}`);
    console.log(`   描述: ${type.description || '无'}`);
    console.log('');
  });
}

main()
  .catch((e) => {
    console.error('查询失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
