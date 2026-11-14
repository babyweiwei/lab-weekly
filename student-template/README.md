# 我的组会汇报仓库（模板）

这是每人一份的**私有仓库**模板。每周把组会 PPT 和进展说明放进来，老师那边会自动汇总。

## 一、第一次使用

1. 在 GitHub 新建一个**私有**仓库，命名规则：`weekly-你的拼音`，例如 `weekly-zhangsan`
   （`weekly-` 前缀是看板的筛选条件，别写错）
2. 把本模板的文件复制进去（或「Use this template」）
3. 确认老师/管理员能看到这个仓库：如果你在课题组组织里，一般已经可见；否则在
   `Settings → Collaborators` 里把老师加为 collaborator

## 二、每周怎么做（两种方式任选）

### 方式 A：网页上传（不用装 git）

1. 打开仓库，点 `Add file → Create new file`
2. 文件名填 `2026-W46/README.md`（**斜杠会自动创建文件夹**），粘贴下面「进展模板」的内容
3. 再点 `Add file → Upload files`，把本周 PPT 传到 `2026-W46/` 目录下
4. Commit changes

### 方式 B：命令行

```bash
git clone https://github.com/<组织>/weekly-<你的拼音>.git
cd weekly-<你的拼音>
mkdir -p 2026-W46
cp ~/Desktop/组会汇报.pptx 2026-W46/
$EDITOR 2026-W46/README.md
git add . && git commit -m "add 2026-W46 组会汇报" && git push
```

## 三、目录命名规则（很重要）

```
weekly-zhangsan/
├── 2026-W45/
│   ├── 组会汇报-张三-W45.pptx
│   └── README.md
├── 2026-W46/
│   ├── 组会汇报-张三-W46.pptx
│   └── README.md
└── 2026-W47/
```

- 目录名必须是 `YYYY-Wxx`，**周次按 ISO 周**（看板顶部会显示当前周次，照着填即可）
- 一周一个目录，不要放到别的地方
- 支持的汇报文件：`.pptx` `.ppt` `.pdf` `.key`，建议 PPTX 或 PDF（PDF 更通用）
- 截止时间默认 **周日 23:59**（以 push 时间为准），超了看板会标「迟交」

## 四、进展模板（每周 README.md）

```markdown
## 本周进展
- 完成了 xxx，指标从 A 提升到 B
- 跑通了 xxx 实验，结果见 PPT 第 3 页

## 遇到的问题
- xxx 还不稳定，正在试 yyy

## 下周计划
- 完成 xxx 消融实验
- 整理中期报告初稿
```

老师端会直接读到这段文字，写在开头两三行最有用的地方。

## 五、自动检查

仓库自带 `.github/workflows/check-submission.yml`，每次 push 会检查：
目录命名是否合规、目录里有没有汇报文件和 README。违规会给出黄色警告，不阻断提交。
