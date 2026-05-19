import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const issueTypes = [
    {
      name: '文献检索与阅读',
      description: '文献查找、文献阅读理解、文献综述等',
      enabled: true,
      requireDirectTransfer: false,
      priorityWeight: 50,
    },
    {
      name: '实验设计与方法',
      description: '实验方案设计、研究方法选择、数据采集等',
      enabled: true,
      requireDirectTransfer: false,
      priorityWeight: 60,
    },
    {
      name: '数据分析与统计',
      description: '数据处理、统计分析、结果解读等',
      enabled: true,
      requireDirectTransfer: false,
      priorityWeight: 70,
    },
    {
      name: '论文写作与投稿',
      description: '论文撰写、期刊选择、投稿流程等',
      enabled: true,
      requireDirectTransfer: false,
      priorityWeight: 60,
    },
    {
      name: '科研工具使用',
      description: '软件工具、编程语言、数据库使用等',
      enabled: true,
      requireDirectTransfer: false,
      priorityWeight: 50,
    },
    {
      name: '学术规范与伦理',
      description: '学术诚信、引用规范、伦理审查等',
      enabled: true,
      requireDirectTransfer: false,
      priorityWeight: 80,
    },
    {
      name: '项目申请与管理',
      description: '基金申请、项目管理、经费使用等',
      enabled: true,
      requireDirectTransfer: false,  // 改为 false，先让 AI 处理
      priorityWeight: 90,
    },
    {
      name: '其他科研问题',
      description: '其他科研相关咨询',
      enabled: true,
      requireDirectTransfer: false,
      priorityWeight: 40,
    },
  ];

  for (const issueTypeData of issueTypes) {
    const existing = await prisma.issueType.findFirst({
      where: { name: issueTypeData.name },
    });

    if (!existing) {
      const issueType = await prisma.issueType.create({
        data: issueTypeData,
      });
      console.log(`✓ 创建咨询类型: ${issueType.name}`);
    } else {
      console.log(`✓ 咨询类型已存在: ${issueTypeData.name}`);
    }
  }

  console.log('\n✅ 咨询类型创建完成！');
}

main()
  .catch((e) => {
    console.error('❌ 创建失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
