import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('正在更新问题类型配置...\n');
  
  // 将"项目申请与管理"的 requireDirectTransfer 改为 false
  const result = await prisma.issueType.updateMany({
    where: {
      name: '项目申请与管理',
    },
    data: {
      requireDirectTransfer: false,
    },
  });

  console.log(`✅ 已更新 ${result.count} 个问题类型`);
  console.log('   "项目申请与管理" 现在不需要直接转人工，会先由 AI 处理');
  
  // 显示所有问题类型的配置
  console.log('\n当前所有问题类型配置：\n');
  const allTypes = await prisma.issueType.findMany({
    where: {
      enabled: true,
      deletedAt: null,
    },
    orderBy: {
      sortOrder: 'asc',
    },
  });

  allTypes.forEach((type, index) => {
    console.log(`${index + 1}. ${type.name}`);
    console.log(`   直接转人工: ${type.requireDirectTransfer ? '是' : '否'}`);
    console.log(`   优先级权重: ${type.priorityWeight}`);
    console.log('');
  });
}

main()
  .catch((e) => {
    console.error('❌ 更新失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
