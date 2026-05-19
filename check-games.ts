import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('正在查询数据库中的游戏...\n');
  
  const games = await prisma.game.findMany({
    where: {
      deletedAt: null,
    },
  });

  console.log(`找到 ${games.length} 个游戏：\n`);
  
  games.forEach((game, index) => {
    console.log(`${index + 1}. ${game.name}`);
    console.log(`   ID: ${game.id}`);
    console.log(`   启用: ${game.enabled ? '是' : '否'}`);
    console.log('');
  });
  
  if (games.length === 0) {
    console.log('数据库中没有游戏记录，需要创建一个默认游戏');
  }
}

main()
  .catch((e) => {
    console.error('查询失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
