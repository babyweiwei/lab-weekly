/* 演示数据：用于在没有 GitHub 凭据时体验界面。
   buildDemoData(weeks) —— weeks 由 app.js 统一生成，保证与真实模式同一形状。 */
window.buildDemoData = function (weeks) {
  const roster = [
    { login: 'zhangsan', name: '张三', topic: '图神经网络在分子性质预测中的应用' },
    { login: 'lisi', name: '李四', topic: '跨模态检索的对比学习框架' },
    { login: 'wangwu', name: '王五', topic: '小样本目标检测的蒸馏方法' },
    { login: 'zhaoliu', name: '赵六', topic: '时序预测中的状态空间模型' },
    { login: 'qianqi', name: '钱七', topic: '多智能体强化学习协作策略' },
    { login: 'sunba', name: '孙八', topic: '扩散模型加速采样' },
  ];

  const progressPool = [
    '本周完成了数据清洗脚本，训练集从 12 万条扩充到 15 万条；\n复现了 baseline，指标与原论文相差 0.4 个点；\n下周计划：加入对比学习分支并跑通消融。',
    '本周主要在做实验调参，学习率与 batch size 的网格搜索已完成一半；\n遇到的问题是梯度爆炸，正在试 gradient clipping；\n下周计划：完成全部实验并整理表格。',
    '本周读了两篇新论文，整理了方法对比表；\n初步实现模块 A，但还没接入主流程；\n下周计划：接入主流程并做端到端测试。',
    '本周写完了中期报告初稿，实验部分还缺一组消融；\n下周计划：补实验，按老师意见改结构。',
  ];

  const students = roster.map((r, idx) => {
    const weeksMap = {};
    weeks.forEach((w, wi) => {
      const isCurrent = wi === weeks.length - 1;
      // 用确定性的伪随机保证每次刷新一致
      const h = (idx * 7 + wi * 13) % 10;
      let status;
      if (isCurrent) status = idx < 4 ? 'ok' : 'todo';
      else if (h < 7) status = 'ok';
      else if (h < 9) status = 'late';
      else status = 'miss';

      if (status === 'miss') return;

      const fileName = `组会汇报-${r.name}-${w.key}.pptx`;
      const path = `${w.key}/${fileName}`;
      const commitDate = new Date(w.start);
      commitDate.setDate(commitDate.getDate() + (status === 'late' ? 8 : 5));
      commitDate.setHours(status === 'late' ? 9 : 21, 30, 0, 0);

      weeksMap[w.key] = {
        status,
        files: status === 'todo' ? [] : [{
          name: fileName,
          path,
          size: 1200000 + ((idx + wi) % 9) * 210000,
          url: `https://github.com/lab-demo/${r.login}-weekly/blob/main/${encodeURI(path)}`,
        }],
        commit: status === 'todo' ? null : {
          date: commitDate.toISOString(),
          sha: ('a1b2c3d' + idx + wi).slice(0, 7),
          message: `add ${w.key} 组会汇报`,
        },
        progress: progressPool[(idx + wi) % progressPool.length],
        demoSlides: status === 'todo' ? null : {
          title: r.topic,
          slides: [
            { index: 1, paragraphs: [`${r.name} · ${w.key} 组会汇报`, r.topic, '指导教师：张老师'] },
            { index: 2, paragraphs: ['本周进展', '· 完成数据清洗与扩充', '· 复现 baseline（差距 0.4 点）', '· 初步跑通模块 A'] },
            { index: 3, paragraphs: ['遇到的问题', '· 训练不稳定，梯度爆炸', '· 对比学习分支显存不足'] },
            { index: 4, paragraphs: ['下周计划', '· 加入对比学习分支', '· 完成消融实验', '· 整理实验表格'] },
          ],
        },
      };
    });

    return {
      login: r.login,
      name: r.name,
      repo: `lab-demo/${r.login}-weekly`,
      repoName: `${r.login}-weekly`,
      url: `https://github.com/lab-demo/${r.login}-weekly`,
      pushedAt: weeks[weeks.length - 1].start.toISOString(),
      weeks: weeksMap,
    };
  });

  return {
    generated_at: new Date().toISOString(),
    owner: 'lab-demo',
    prefix: 'weekly-',
    demo: true,
    weeks: weeks.map((w) => ({ key: w.key, start: w.start.toISOString(), end: w.end.toISOString() })),
    students,
  };
};
